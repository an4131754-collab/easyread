const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function reader(mode = "server") {
  const nodes = new Map();
  const events = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      listeners: {}, children: [], style: {}, checked: true, complete: true, clientWidth: 480, clientHeight: 480, offsetHeight: 1000,
      addEventListener(name, fn) { this.listeners[name] = fn; },
      replaceChildren(...children) { this.children = children; },
      scrollTo(value) { this.scroll = value; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; },
      getAttribute(name) { return this[name] || null; }, setAttribute(name, value) { this[name] = value; },
    });
    return nodes.get(selector);
  }
  let reading = "head", selected = null;
  const PR = {
    state: { paper: { meta: { pages: [{ img: "pages/one.webp" }, { img: "pages/two.webp" }] } }, layout: {} },
    $: node, on(name, fn) { events.set(name, fn); }, store: { mode }, imageUrl: img => "/p/paper/" + img,
    pdfUrl: page => "/p/paper/source.pdf#page=" + page,
    readingBlock: () => reading, currentBlock: () => selected,
    blockById: { first: { page: 1 }, second: { page: 2 } },
    jumpTo(id) { this.jumped = id; },
    fitWide() {}, renderMargin() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../easyread/web/js/reader/pageview.js"), "utf8"), {
    window: { PR }, document: { body: node("body"), getElementById: () => null, createElement: () => ({ style: {} }) },
    devicePixelRatio: 1, Image: class {}, setTimeout: () => 1, clearTimeout() {},
  });
  return { PR, node, events, read: id => { reading = id; }, select: id => { selected = id; } };
}

test("opening original pages at the paper title loads the first image", () => {
  const r = reader();
  r.PR.togglePages(true);
  assert.equal(r.node(".pv-page img").src, "/p/paper/pages/one.webp?w=1000");
  assert.equal(r.node(".pv-label").textContent, "第 1 / 2 頁");
});

test("scrolling follows the reading position after another block was selected", () => {
  const r = reader();
  r.select("second"); r.read("second"); r.PR.togglePages(true);
  assert.equal(r.node(".pv-page img").src, "/p/paper/pages/two.webp?w=1000");
  r.read("first"); r.PR.syncPage(false);
  assert.equal(r.node(".pv-page img").src, "/p/paper/pages/one.webp?w=1000");
});

test("turning off follow retains the manually selected original page", () => {
  const r = reader();
  r.select("second"); r.PR.togglePages(true);
  r.node(".pv-follow input").checked = false;
  r.read("first"); r.PR.syncPage(false);
  assert.equal(r.node(".pv-page img").src, "/p/paper/pages/two.webp?w=1000");
});

const crossing = () => ({ page: 1, box: [0.08, 0.10, 0.92, 0.90], boxes: [[0.08, 0.60, 0.48, 0.90], [0.52, 0.10, 0.92, 0.30]] });

test("server and offline readers draw separate regions and scroll to the first column", () => {
  for (const mode of ["server", "static"]) {
    const r = reader(mode);
    r.PR.state.layout.first = crossing();
    r.PR.openPage(1, "first");
    const regions = r.node(".pv-hl").children;
    assert.equal(regions.length, 2);
    assert.equal(regions[0].className, "pv-region");
    assert.equal(parseFloat(regions[0].style.left), 7.6);
    assert.equal(parseFloat(regions[1].style.left), 51.6);
    assert.ok(Math.abs(parseFloat(regions[0].style.height) - 30.6) < 0.000001);
    assert.equal(r.node(".pv-scroll").scroll.top, 528);
    assert.equal(r.node(".pv-page img").src, "/p/paper/pages/one.webp" + (mode === "server" ? "?w=1000" : ""));
  }
});

test("clicks hit either column fragment but leave the gutter and unrelated text alone", () => {
  const r = reader();
  r.PR.state.layout.first = crossing();
  r.PR.openPage(1, "first");
  const page = r.node(".pv-page");
  for (const [x, y, expected] of [[0.20, 0.75, "b-first"], [0.70, 0.20, "b-first"], [0.50, 0.70, null], [0.70, 0.75, null]]) {
    r.PR.jumped = null;
    page.listeners.click({ currentTarget: page, clientX: x * 1000, clientY: y * 1000 });
    assert.equal(r.PR.jumped, expected);
  }
});

test("legacy single boxes work and layout refresh replaces the visible regions", () => {
  const r = reader();
  r.PR.state.layout.first = { page: 1, box: [0.08, 0.60, 0.48, 0.90] };
  r.PR.openPage(1, "first");
  assert.equal(r.node(".pv-hl").children.length, 1);
  r.PR.state.layout.first = crossing();
  r.events.get("remote")(["layout"]);
  assert.equal(r.node(".pv-hl").children.length, 2);
});
