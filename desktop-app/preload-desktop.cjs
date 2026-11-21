const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairyDesktop', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('fairy:set-ignore-mouse', Boolean(ignore)),
  setShape: (rects) => ipcRenderer.send('fairy:set-shape', Array.isArray(rects) ? rects : null),
  setWindowRect: (rect) => ipcRenderer.send('fairy:set-window-rect', rect || null),
  getDisplayBounds: () => ipcRenderer.invoke('fairy:get-display-bounds'),
  setFocusable: (focusable) => ipcRenderer.send('fairy:set-focusable', Boolean(focusable)),
  setPhase: (phase) => ipcRenderer.send('fairy:set-phase', String(phase || 'dock')),
  getState: () => ipcRenderer.invoke('fairy:get-state'),
  onState: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('fairy:state', handler);
    return () => ipcRenderer.removeListener('fairy:state', handler);
  },
  onCommand: (cb) => {
    const handler = (_event, cmd) => cb(cmd);
    ipcRenderer.on('fairy:cmd', handler);
    return () => ipcRenderer.removeListener('fairy:cmd', handler);
  },
  onSpeak: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('fairy:speak', handler);
    return () => ipcRenderer.removeListener('fairy:speak', handler);
  },
  setTtsEnabled: (enabled) => ipcRenderer.send('fairy:set-tts', Boolean(enabled)),
  setAutoMute: (enabled) => ipcRenderer.send('fairy:set-auto-mute', Boolean(enabled)),
  speakText: (text) => ipcRenderer.invoke('fairy:speak-text', String(text || '')),
  notifyReady: () => ipcRenderer.send('fairy:ready'),
  getStartup: () => ipcRenderer.invoke('fairy:get-startup'),
  setStartup: (enabled) => ipcRenderer.invoke('fairy:set-startup', Boolean(enabled)),
  triggerVoice: (payload) => ipcRenderer.invoke('fairy:trigger-voice', payload),
  hybridAction: (req) => ipcRenderer.invoke('fairy:hybrid-action', req),
  quit: () => ipcRenderer.send('fairy:quit'),
});
