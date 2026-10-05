const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require("electron");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const windowState = require("./window-state.cjs");
const http = require("http");
const { URL } = require("url");
const { registerUpdates } = require("./desktop-updates.cjs");

// 視窗快取等放 %APPDATA%\EasyRead（預設會用 package.json 的 name，叫 easyread-desktop）。
// 論文和設定不放這裡：打包後的後端預設用 ~/EasyRead，和 pip 安裝版同一個位置，使用者找得到、好備份。
app.setPath("userData", path.join(app.getPath("appData"), "EasyRead"));

let backend;
let mainWindow;
let backendReady;
let windowOpening = false;
let backendUrl;

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function packagedBackend() {
  const name = process.platform === "win32" ? "easyread-backend.exe" : "easyread-backend";
  return path.join(process.resourcesPath, "backend", name);
}

function backendCommand() {
  if (app.isPackaged) {
    const executable = packagedBackend();
    if (!fs.existsSync(executable)) {
      throw new Error(`找不到打包後的 EasyRead 後端：${executable}`);
    }
    return { command: executable, args: ["serve", "--port", "0"], cwd: os.homedir() };
  }

  const root = projectRoot();
  const python = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  const command = fs.existsSync(python) ? python : (process.platform === "win32" ? "python" : "python3");
  return { command, args: ["-m", "easyread", "serve", "--port", "0"], cwd: root };
}

// macOS / Linux 從啟動臺、桌面圖示開啟時，拿不到終端裡配的 PATH（Homebrew、npm 全域性目錄），
// 後端會找不到 claude / codex。向用戶的登入 shell 要一份 PATH 補上。
function loginShellPath() {
  if (process.platform === "win32") return "";
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/__PATH__(.*)__PATH__/);
    return m ? m[1] : "";
  } catch (_) {
    return "";
  }
}

function startBackend() {
  // On macOS an app can stay alive after its last window closes. Reopening
  // the window must reuse that backend, rather than orphaning the old one.
  if (backendReady) return backendReady;
  const launch = backendCommand();
  const env = { ...process.env, PYTHONUTF8: "1" };
  const shellPath = loginShellPath();
  if (shellPath) {
    env.PATH = [...new Set([...shellPath.split(":"), ...(env.PATH || "").split(":")].filter(Boolean))].join(":");
  }
  if (process.platform !== "win32") {
    const fallback = [path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
    env.PATH = [...new Set([...(env.PATH || "").split(":"), ...fallback.filter(p => fs.existsSync(p))].filter(Boolean))].join(":");
  }

  backendReady = new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`EasyRead 後端啟動超時。${output.slice(-500)}`));
      stopBackend();
    }, 30000);

    backend = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stdout.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-65536);
      const match = output.match(/EasyRead\s+已啟動：\s*(http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { backendUrl = match[1]; finish(resolve, match[1]); }
    });
    backend.stderr.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-65536);
    });
    backend.once("error", (error) => finish(reject, error));
    backend.once("exit", (code, signal) => {
      if (!settled) finish(reject, new Error(`EasyRead 後端退出（code=${code}, signal=${signal}）。${output.slice(-500)}`));
      backend = undefined;
      backendReady = undefined;
      backendUrl = undefined;
    });
  });
  return backendReady;
}

function stopBackend() {
  backendReady = undefined;
  if (backend && !backend.killed) {
    if (process.platform === "win32") {
      // PyInstaller's one-file launcher creates a child process. Killing only
      // the launcher would leave the local HTTP service running after exit.
      try {
        execFileSync("taskkill", ["/pid", String(backend.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch (_) {
        // The process may already have exited while the window was closing.
      }
    } else {
      backend.kill();
    }
    backend = undefined;
  }
}

function trustedWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || !backendUrl ||
      new URL(event.senderFrame.url).origin !== backendUrl) {
    throw new Error("Untrusted IPC sender");
  }
}

function backendJson(endpoint, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(endpoint, backendUrl), {
      method: token ? "POST" : "GET",
      headers: token ? { "X-Token": token, "Content-Type": "application/json", "Content-Length": 2 } : {},
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", part => { body += part; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200) return reject(new Error(data.error || `HTTP ${res.statusCode}`));
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("後端關閉逾時，請稍後重試。")));
    req.on("error", reject);
    req.end(token ? "{}" : undefined);
  });
}

async function stopBackendGracefully() {
  const child = backend;
  if (!child) return;
  const info = await backendJson("/api/library");
  await backendJson("/api/shutdown", info.token);
  if (backend !== child) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", exited);
      reject(new Error("後端尚未退出，請稍後重試。"));
    }, 8000);
    function exited() { clearTimeout(timer); resolve(); }
    child.once("exit", exited);
  });
}

async function createWindow() {
  if (windowOpening || mainWindow) return;
  windowOpening = true;
  let url;
  try {
    url = await startBackend();
  } catch (error) {
    windowOpening = false;
    dialog.showErrorBox("EasyRead 啟動失敗", error.message);
    app.quit();
    return;
  }

  const state = windowState.options();
  mainWindow = new BrowserWindow({
    ...state.opts,
    minWidth: 960,
    minHeight: 680,
    icon: path.join(__dirname, "assets", "icon.ico"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  // A native context menu is separate from the application Edit menu.
  // Electron does not emit this event when the page prevents contextmenu,
  // so the library's and reader's custom menus keep working.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const flags = params.editFlags || {};
    const items = params.isEditable
      ? [{ role: "undo", enabled: flags.canUndo }, { role: "redo", enabled: flags.canRedo },
         { type: "separator" }, { role: "cut", enabled: flags.canCut }, { role: "copy", enabled: flags.canCopy },
         { role: "paste", enabled: flags.canPaste }, { type: "separator" }, { role: "selectAll" }]
      : params.selectionText.trim() ? [{ role: "copy" }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  windowState.track(mainWindow);
  mainWindow.once("ready-to-show", () => {
    if (state.maximized) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  try {
    await mainWindow.loadURL(url);
  } finally {
    windowOpening = false;
  }
}

// Keep the web application's own header at the top of the content area. The
// default Electron File/Edit/View/Window strip would otherwise create a second
// toolbar row above it. The macOS menu is at the top of the screen and
// its Edit roles provide Cmd+C/V/X/A/Z.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(process.platform === "darwin"
    ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
    : null);
  app.whenReady().then(() => {
    registerUpdates({
      app, ipcMain, updater: require("electron-updater").autoUpdater, trustedWindow,
      getWindow: () => mainWindow,
      prepareInstall: stopBackendGracefully,
      recover: async () => {
        if (backend) return; // A running task refused shutdown; keep the current page.
        const previous = mainWindow && mainWindow.webContents.getURL();
        const url = await startBackend();
        if (mainWindow) {
          const old = previous && new URL(previous);
          await mainWindow.loadURL(old ? new URL(old.pathname + old.search, url).href : url);
        }
      },
    });
    createWindow();
  });
  app.on("before-quit", stopBackend);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("second-instance", () => {
    if (!mainWindow) return void createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  process.on("exit", stopBackend);
}
