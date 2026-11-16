"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("shortsDesktop", {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke("shorts-desktop:open-external", String(url || "")),
  dataPath: () => ipcRenderer.invoke("shorts-desktop:data-path"),
  installUpdate: (payload) => ipcRenderer.invoke("shorts-desktop:install-update", payload),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("shorts-desktop:update-status", listener);
    return () => ipcRenderer.removeListener("shorts-desktop:update-status", listener);
  },
});
