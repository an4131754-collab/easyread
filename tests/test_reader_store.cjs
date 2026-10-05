const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

async function offlineReader() {
  const storage = new Map();
  const PR = {
    uid: () => "client", nowIso: () => "2026-10-01T00:00:00Z", emit() {},
    ls: { get: (key, fallback) => storage.get(key) || fallback, set: (key, value) => { storage.set(key, value); return true; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../easyread/web/js/reader/store.js"), "utf8"), {
    window: { PR, addEventListener() {} }, location: { pathname: "" },
    document: { getElementById: () => ({ textContent: JSON.stringify({ paper: { meta: { source_sha256: "paper0001" } }, reader: {} }) }) },
    setTimeout() {}, clearTimeout() {},
  });
  await PR.load();
  return PR;
}

test("offline deletes survive delayed note creation and export/import", async () => {
  const note = { op: "note", note: { id: "n1", body: "old", updated: "2026-10-01T00:01:00Z" } };
  const remove = { op: "note_del", id: "n1", at: "2026-10-01T00:02:00Z" };
  for (const ops of [[note, remove], [remove, note]]) {
    const PR = await offlineReader();
    ops.forEach(op => PR.commit(op));
    assert.equal(PR.state.reader.notes.n1.deleted, true);
    assert.equal(PR.exportOps().ops.find(op => op.op === "note").note.deleted, true);
    PR.commit({ ...note, note: { ...note.note, updated: "2026-10-01T00:03:00Z" } });
    assert.ok(!PR.state.reader.notes.n1.deleted);
  }
});

test("saving notes does not swallow a concurrent paper update", async () => {
  const PR = { uid: () => "client", nowIso: () => "2026-10-01T00:00:00Z", emit() {},
    ls: { get: (key, fallback) => fallback, set: () => true } };
  const fetch = async url => ({ ok: true, status: 200, json: async () => {
    if (url.endsWith("/state")) return { paper: { meta: {} }, reader: {}, token: "test", versions: { paper: "p1", reader: "r1" } };
    if (url.endsWith("/ops")) return { rev: 1, versions: { paper: "p2", reader: "r2" } };
    if (url.endsWith("/versions")) return { paper: "p2", reader: "r2" };
    if (url.endsWith("/part/paper")) return { version: "p2", data: { meta: {}, translated: true } };
    throw Error(url);
  } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../easyread/web/js/reader/store.js"), "utf8"), {
    window: { PR, addEventListener() {} }, location: { pathname: "/read/fixture" },
    document: { getElementById: () => null, hidden: false }, fetch, setTimeout() {}, clearTimeout() {},
  });
  await PR.load();
  PR.commit({ op: "paper_note", body: "saved note" });
  await PR.flush();
  assert.equal(PR.state.versions.paper, "p1");
  await PR.poll();
  assert.equal(PR.state.versions.paper, "p2");
  assert.equal(PR.state.paper.translated, true);
});
