const { contextBridge } = require('electron');

// If needed, you can inject minimal CSS (for example to hide page chrome) via this bridge later.
// Keep it empty and safe for now—no Node exposed.
contextBridge.exposeInMainWorld('kanbanDesktop', {
  // placeholder for future APIs
});
