// Exposes one function to the page: send MIDI bytes to a named output through CoreMIDI (see native/midi-send.swift).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chocolateNative', {
  sendMidi: (outputName, bytes) => ipcRenderer.invoke('midi:send', String(outputName), Array.from(bytes)),
});
