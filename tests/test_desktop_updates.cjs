const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerUpdates } = require("../electron/desktop-updates.cjs");

function fixture(overrides = {}) {
  const handlers = {};
  const updater = new EventEmitter();
  const calls = [];
  updater.setFeedURL = feed => { updater.feed = feed; };
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: "1.3.2" } });
  updater.downloadUpdate = async () => { calls.push("download"); updater.emit("update-downloaded", { version: "1.3.2" }); };
  updater.quitAndInstall = (...args) => calls.push(["install", ...args]);
  registerUpdates({
    app: { isPackaged: true }, updater,
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    trustedWindow: event => { if (event !== "trusted") throw Error("Untrusted"); },
    getWindow: () => null,
    prepareInstall: async () => { calls.push("shutdown"); },
    recover: async () => { calls.push("recover"); },
    ...overrides,
  });
  return { updater, calls, run: (name, event = "trusted") => handlers[`easyread:update-${name}`](event) };
}

test("download finishes before installation and stops backend before silent relaunch", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal((await f.run("download")).phase, "downloaded");
  assert.deepEqual(f.calls, ["download"]);
  await f.run("install");
  assert.deepEqual(f.calls, ["download", "shutdown", ["install", true, true]]);
});

test("updates are restricted to the fork's stable releases", { skip: process.platform !== "win32" }, () => {
  const f = fixture();
  assert.deepEqual(f.updater.feed, { provider: "github", owner: "an4131754-collab", repo: "easyread" });
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
});

test("a busy backend blocks installation and preserves the downloaded installer", { skip: process.platform !== "win32" }, async () => {
  const f = fixture({ prepareInstall: async () => { throw Error("work in progress"); } });
  await f.run("download");
  const state = await f.run("install");
  assert.equal(state.phase, "downloaded");
  assert.match(state.error, /work in progress/);
  assert.deepEqual(f.calls, ["download", "recover"]);
});

test("an installer error restarts the backend", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  await f.run("download");
  await f.run("install");
  f.updater.emit("error", Error("installer failed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.run("state")).phase, "error");
  assert.equal(f.calls.at(-1), "recover");
});

test("development desktop instances retain manual updates", async () => {
  const f = fixture({ app: { isPackaged: false } });
  assert.equal((await f.run("state")).supported, false);
  await f.run("download");
  assert.equal(f.updater.feed, undefined);
  assert.deepEqual(f.calls, []);
});

test("failed download can retry", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  const download = f.updater.downloadUpdate;
  f.updater.downloadUpdate = async () => { throw Error("offline"); };
  assert.equal((await f.run("download")).phase, "error");
  f.updater.downloadUpdate = download;
  assert.equal((await f.run("download")).phase, "downloaded");
});

test("no available update does not download; install without download does nothing", async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  await f.run("download");
  await f.run("install");
  assert.deepEqual(f.calls, []);
});

test("untrusted renderer cannot invoke update operations", async () => {
  const f = fixture();
  assert.throws(() => f.run("state", "foreign"), /Untrusted/);
  await assert.rejects(f.run("download", "foreign"), /Untrusted/);
  await assert.rejects(f.run("install", "foreign"), /Untrusted/);
});

test("concurrent downloads are coalesced", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  await Promise.all([f.run("download"), f.run("download")]);
  assert.deepEqual(f.calls, ["download"]);
});
