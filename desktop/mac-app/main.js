// Mac app for Chocolate Studio: a window around the built web editor (../../apps/web/dist, copied to ./web by
// build.sh). Nothing runs outside the page: no backend, no network service. The page is served from app://studio
// (a secure, standard scheme, so Web MIDI, IndexedDB and localStorage work as on the web), and the only permission
// granted is MIDI with SysEx, which the editor needs to read and write the Chocolate.
// Outgoing MIDI goes through a small CoreMIDI helper (native/midi-send.swift): the Chocolate Plus ignored the
// fragmented SysEx that Chromium's Web MIDI output produced. Incoming MIDI still uses Web MIDI.
const { app, BrowserWindow, ipcMain, protocol, net, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB_ROOT = path.join(__dirname, 'web');
const ORIGIN = 'app://studio';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

function serveWebRoot() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.host !== 'studio') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB_ROOT, relative));
    // never outside the bundled web build
    if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

const MIDI_PERMISSIONS = new Set(['midi', 'midiSysex']);
// URL.origin is "null" for a custom scheme, so compare protocol and host
function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'app:' && url.host === 'studio'; } catch { return false; }
}
function limitPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(MIDI_PERMISSIONS.has(permission) && isAppUrl((details && details.requestingUrl) || webContents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    MIDI_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin || (webContents && webContents.getURL()) || ''));
}

// The packaged app keeps its files in app.asar; an executable cannot run from inside it, so build.sh unpacks bin/
// to app.asar.unpacked.
const HELPER = path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'bin', 'chocolate-midi-send');
let helper = null;
let nextId = 1;
const waiting = new Map();
function startHelper() {
  if (helper) return helper;
  if (!fs.existsSync(HELPER)) throw new Error('midi-helper-missing');
  const child = spawn(HELPER, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const [id, status, reason] = buffered.slice(0, newline).split('\t');
      buffered = buffered.slice(newline + 1);
      const entry = waiting.get(id);
      if (!entry) continue;
      waiting.delete(id);
      if (status === 'ok') entry.resolve(); else entry.reject(new Error('midi-send:' + (reason || 'failed')));
    }
  });
  child.on('exit', () => {
    if (helper === child) helper = null;
    for (const entry of waiting.values()) entry.reject(new Error('midi-send:helper-exited'));
    waiting.clear();
  });
  helper = child;
  return child;
}
function nativeSend(outputName, bytes) {
  if (typeof outputName !== 'string' || !outputName || /[\t\n]/.test(outputName)) throw new Error('midi-send:bad-name');
  if (!Array.isArray(bytes) || !bytes.length || bytes.length > 8192 ||
      !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('midi-send:bad-bytes');
  const child = startHelper();
  const id = String(nextId++);
  const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('midi-send:timeout')); }, 3000);
    waiting.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(id + '\t' + outputName + '\t' + hex + '\n');
  });
}
ipcMain.handle('midi:send', (event, outputName, bytes) => {
  if (!isAppUrl(event.senderFrame ? event.senderFrame.url : '')) throw new Error('midi-send:forbidden');
  return nativeSend(outputName, bytes);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 900, minHeight: 640,
    title: 'Chocolate Studio',
    backgroundColor: '#f3f2ef',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  // links to manuals, GitHub etc. open in the browser; the window itself never leaves the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(ORIGIN + '/index.html');

  // CHOCOLATE_SELFTEST=<png path>: load, record whether Web MIDI with SysEx is granted, save a screenshot, quit.
  if (process.env.CHOCOLATE_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const midi = await win.webContents.executeJavaScript(
        "navigator.requestMIDIAccess({ sysex: true }).then(a => 'granted, inputs ' + a.inputs.size, e => 'refused: ' + e.name)");
      const title = await win.webContents.executeJavaScript('document.title');
      const image = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.CHOCOLATE_SELFTEST, image.toPNG());
      console.log('SELFTEST title=' + title + ' midi=' + midi + ' url=' + win.webContents.getURL());
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  serveWebRoot();
  limitPermissions();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (helper) helper.kill(); });
