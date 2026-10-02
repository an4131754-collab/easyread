const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

async function desktop(platform = "darwin", lock = true) {
  const app = new EventEmitter();
  Object.assign(app, {
    setPath() {}, getPath: () => "/tmp", isPackaged: true,
    requestSingleInstanceLock: () => lock, whenReady: () => Promise.resolve(),
    quit() { this.quitCalled = true; this.emit("before-quit"); },
  });
  const windows = [], launches = [], menus = [];
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; windows.push(this); }
    static getAllWindows() { return windows.filter(w => !w.closed); }
    async loadURL(url) { this.url = url; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    isMinimized() { return false; }
    close() { this.closed = true; this.emit("closed"); }
  }
  const Menu = {
    buildFromTemplate(items) { return { items, popup() { menus.push(items); } }; },
    setApplicationMenu(menu) { app.menu = menu; },
  };
  const childProcess = {
    execFileSync: () => "__PATH__/usr/bin:/bin__PATH__",
    spawn(command, args, options) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { child.killed = true; child.emit("exit", 0, "SIGTERM"); };
      launches.push({ command, args, options, child });
      queueMicrotask(() => child.stdout.emit("data", "EasyRead 已啟動：http://127.0.0.1:9876\n"));
      return child;
    },
  };
  const proc = new EventEmitter();
  Object.assign(proc, { platform, env: {}, resourcesPath: "/tmp/Resources" });
  const fakeRequire = name => name === "electron" ? { app, BrowserWindow: Window, Menu, dialog: { showErrorBox() {} }, shell: {} }
    : name === "child_process" ? childProcess : name === "fs" ? { existsSync: () => true }
    : name === "./window-state.cjs" ? { options: () => ({ opts: { width: 1440, height: 960 }, maximized: false }), track() {} }
    : require(name);
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  vm.runInNewContext(source, { require: fakeRequire, process: proc, __dirname: "/tmp/electron", setTimeout, clearTimeout, console });
  const settled = () => new Promise(resolve => setImmediate(resolve));
  await settled();
  return { app, windows, launches, menus, settled };
}

test("macOS keeps native editing roles and offers input context actions", async () => {
  const d = await desktop();
  assert.deepEqual(Array.from(d.app.menu.items, x => x.role), ["appMenu", "editMenu", "windowMenu"]);
  d.windows[0].webContents.emit("context-menu", {}, { isEditable: true, selectionText: "", editFlags: { canPaste: true } });
  assert.ok(d.menus[0].some(x => x.role === "paste" && x.enabled));
  d.app.quit();
});

test("reopening a macOS window reuses one backend, even during repeated activation", async () => {
  const d = await desktop();
  d.windows[0].close();
  d.app.emit("activate"); d.app.emit("activate");
  await d.settled();
  assert.equal(d.launches.length, 1);
  assert.equal(d.windows.length, 2);
  d.app.emit("second-instance");
  assert.equal(d.windows[1].focused, true);
  d.app.quit();
  assert.equal(d.launches[0].child.killed, true);
});

test("a second app instance exits before starting a backend", async () => {
  const d = await desktop("darwin", false);
  assert.equal(d.app.quitCalled, true);
  assert.equal(d.launches.length, 0);
});

test("Windows retains its existing menu behavior", async () => {
  const d = await desktop("win32");
  assert.equal(d.app.menu, null);
  d.app.quit();
});
