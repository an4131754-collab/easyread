// Windows NSIS updates. Only the main process chooses the trusted release feed.
function registerUpdates({ app, ipcMain, updater, trustedWindow, getWindow, prepareInstall, recover }) {
  const supported = app.isPackaged && process.platform === "win32";
  let state = { supported, phase: "idle", version: "", percent: 0, error: "" };
  let busy = false;
  const publish = (patch) => {
    state = { ...state, ...patch };
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("easyread:update-state", state);
  };
  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.fullChangelog = false;
    updater.setFeedURL({ provider: "github", owner: "an4131754-collab", repo: "easyread" });
    updater.on("error", error => {
      const installing = state.phase === "installing";
      publish({ phase: "error", error: error.message });
      if (installing) Promise.resolve().then(recover).catch(e => publish({ error: e.message }));
    });
    updater.on("download-progress", progress => publish({ phase: "downloading", percent: progress.percent }));
    updater.on("update-downloaded", info => publish({ phase: "downloaded", version: info.version, percent: 100 }));
  }
  ipcMain.handle("easyread:update-state", event => { trustedWindow(event); return state; });
  ipcMain.handle("easyread:update-download", async event => {
    trustedWindow(event);
    if (!supported || busy || state.phase === "downloaded") return state;
    busy = true;
    try {
      publish({ phase: "checking", error: "", percent: 0 });
      const result = await updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        publish({ phase: "current" });
      } else {
        publish({ phase: "downloading", version: result.updateInfo.version });
        await updater.downloadUpdate();
      }
    } catch (error) { publish({ phase: "error", error: error.message }); }
    finally { busy = false; }
    return state;
  });
  ipcMain.handle("easyread:update-install", async event => {
    trustedWindow(event);
    if (!supported || busy || state.phase !== "downloaded") return state;
    busy = true;
    try {
      publish({ phase: "installing", error: "" });
      await prepareInstall();
      updater.quitAndInstall(true, true);
    } catch (error) {
      publish({ phase: "downloaded", error: error.message });
      try { await recover(); } catch (e) { publish({ error: e.message }); }
    } finally { busy = false; }
    return state;
  });
}

module.exports = { registerUpdates };
