// The page's only native bridge: MIDI to and from a named port through CoreMIDI (see native/midi-send.swift).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chocolateNative', {
  sendMidi: (outputName, bytes) => ipcRenderer.invoke('midi:send', String(outputName), Array.from(bytes)),
  listenMidi: inputName => ipcRenderer.invoke('midi:listen', String(inputName)),
  stopMidi: () => ipcRenderer.invoke('midi:stop'),
  onMidiIn: callback => {
    const listener = (_event, bytes) => callback(Uint8Array.from(bytes));
    ipcRenderer.on('midi:in', listener);
    return () => ipcRenderer.removeListener('midi:in', listener);
  },
});
