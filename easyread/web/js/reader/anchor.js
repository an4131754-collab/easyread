/* 劃線錨定（參考 Hypothesis 的 TextQuote：原話 + 前後文）和選中文字後的浮動條。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const SKIP = ".katex-mathml, .stale-tag, button, .en-title, .num";

  function textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n; (n = w.nextNode());) out.push(n);
    return out;
  }
  const fullText = (root) => textNodes(root).map((t) => t.data).join("");
  PR.fullText = fullText;

  function offsetOf(root, container, offset) {
    let pos = 0;
    for (const t of textNodes(root)) {
      if (t === container) return pos + offset;
      const r = document.createRange();
      r.selectNodeContents(t);
      if (r.comparePoint(container, offset) < 0) return pos;
      pos += t.data.length;
    }
    return pos;
  }

  function findQuote(text, q, prefix, suffix) {
    if (!q) return -1;
    let best = -1, bestScore = -1;
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
      let score = 0;
      if (prefix && text.slice(Math.max(0, i - prefix.length), i).endsWith(prefix.slice(-8))) score += 2;
      if (suffix && text.slice(i + q.length, i + q.length + suffix.length).startsWith(suffix.slice(0, 8))) score += 2;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  function wrap(root, start, end, attrs) {
    let pos = 0;
    for (const t of textNodes(root)) {
      const a = pos, b = pos + t.data.length;
      pos = b;
      if (b <= start || a >= end) continue;
      let node = t;
      const s = Math.max(start, a) - a, e = Math.min(end, b) - a;
      if (e < node.data.length) node.splitText(e);
      if (s > 0) node = node.splitText(s);
      const m = document.createElement("mark");
      for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
      node.parentNode.insertBefore(m, node);
      m.appendChild(node);
    }
  }

  const lost = new Set();
  PR.quoteLost = (id) => lost.has(id);

  function zhFor(item) {
    const host = document.getElementById("b-" + item.anchor);
    if (!host) return null;
    if (item.key) return host.querySelector('.zh[data-key="' + CSS.escape(item.key) + '"]');
    return PR.$$(".zh", host).find((z) => fullText(z).includes(item.quote)) || host.querySelector(".zh");
  }

  function targetFor(item) {
    const host = document.getElementById("b-" + item.anchor);
    if (!host) return null;
    if (item.lang === "en" && item.key) {
      return host.querySelector('.en[data-key="' + CSS.escape(item.key) + '"]') ||
        host.querySelector('.zh.en-main[data-key="' + CSS.escape(item.key) + '"]');
    }
    return zhFor(item);
  }

  function counterpartFor(root) {
    const pair = root && root.closest(".translation-pair");
    if (!pair) return null;
    if (root.matches(".en")) return pair.querySelector(".zh");
    if (root.matches(".zh")) return pair.querySelector(".en");
    return null;
  }

  PR.applyMarks = function (onlyBlock) {
    const scope = onlyBlock ? document.getElementById("b-" + onlyBlock) : PR.$("#paper");
    if (!scope) return;
    PR.$$("mark.hl", scope).forEach((m) => m.replaceWith(...m.childNodes));
    scope.normalize();
    if (!onlyBlock) lost.clear();
    const items = [];
    for (const n of PR.myNotes()) if (n.quote) items.push({ n, attrs: { class: "hl c-" + (n.color || "yellow") + (n.style === "underline" ? " s-ul" : "") + (n.kind === "question" ? " q" : ""), "data-note": n.id } });
    for (const e of S.discussion.entries || []) if (e.quote && e.anchor) items.push({ n: e, attrs: { class: "hl agent", "data-card": e.id } });
    for (const { n, attrs } of items) {
      if (onlyBlock && n.anchor !== onlyBlock) continue;
      const target = targetFor(n);
      const text = target ? fullText(target) : "";
      const i = target ? findQuote(text, n.quote, n.prefix, n.suffix) : -1;
      if (i < 0) { lost.add(n.id); continue; }
      lost.delete(n.id);
      wrap(target, i, i + n.quote.length, attrs);
      if (n.kind === "highlight") {
        const counterpart = counterpartFor(target);
        const pairedText = counterpart && fullText(counterpart);
        if (counterpart && pairedText) wrap(counterpart, 0, pairedText.length, attrs);
      }
    }
  };

  /* ---------- 選中文字 -> 浮動條 ---------- */
  const selbar = () => PR.$("#selbar");
  let pendingSel = null;

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const root = startEl && startEl.closest("#paper .en, #paper .zh");
    if (!root || !root.contains(range.endContainer) || root.querySelector("textarea")) return null;
    const lang = root.getAttribute("lang") === "en" || root.classList.contains("en") ? "en" : "zh";
    const pair = root.closest(".translation-pair");
    const key = root.dataset.key || (pair && pair.querySelector(".zh") && pair.querySelector(".zh").dataset.key);
    const text = fullText(root);
    const s = offsetOf(root, range.startContainer, range.startOffset);
    const e = offsetOf(root, range.endContainer, range.endOffset);
    const quote = text.slice(s, e);
    if (!quote.trim()) return null;
    return { anchor: root.closest(".blk").dataset.id, key, lang, quote, prefix: text.slice(Math.max(0, s - 32), s), suffix: text.slice(e, e + 32), rect: range.getBoundingClientRect() };
  }
  PR.hasPendingSelection = () => !!pendingSel && selbar().classList.contains("open");

  function showSelbar() {
    pendingSel = readSelection();
    const bar = selbar();
    if (!pendingSel) { bar.classList.remove("open"); return; }
    PR.hideBlockbar && PR.hideBlockbar();
    const pen = PR.prefs.pen === "underline" ? "underline" : "marker";
    bar.innerHTML = '<span class="pens"><button data-pen="marker" class="' + (pen === "marker" ? "on" : "") + '" title="熒光筆：塗底色">' + PR.icon("marker", "sm") + "</button>" +
      '<button data-pen="underline" class="' + (pen === "underline" ? "on" : "") + '" title="下劃線">' + PR.icon("underline", "sm") + "</button></span>" +
      '<span class="dots pen-' + pen + '">' + PR.HL_COLORS.map(([c, name], i) =>
      '<button data-s="highlight" data-color="' + c + '" class="dot-' + c + '" title="' + name + (pen === "underline" ? "色下劃線" : "色熒光筆") + (PR.keysOn ? "（" + (i + 1) + "）" : "") + '"></button>').join("") + "</span>" +
      '<button data-s="note" title="寫筆記（N）">' + PR.icon("note", "sm") + "筆記</button>" +
      '<button data-s="question" title="提問（Q）">' + PR.icon("question", "sm") + "提問</button>" +
      (PR.canChat && PR.canChat() && PR.feature("chat") ? '<button data-s="chat" title="把這句引用到問 AI（可以引用多段）">' + PR.icon("sparkle", "sm") + (PR.chatOpen && PR.chatOpen() ? "引用到對話" : "問 AI") + "</button>" : "") +
      (pendingSel.lang === "en" ? "" : '<button data-s="en" title="看這段英文">' + PR.icon("en", "sm") + "原文</button>") +
      '<button data-s="copy" title="複製">' + PR.icon("copy", "sm") + "</button>";
    bar.classList.add("open");
    const r = pendingSel.rect, w = bar.offsetWidth;
    const x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.top - 48 < 58 ? r.bottom + 8 : r.top - 48;
    bar.style.left = x + "px"; bar.style.top = y + "px";
  }
  document.addEventListener("mouseup", (e) => { if (!(e.target.closest && e.target.closest("#selbar, #blockbar"))) setTimeout(showSelbar, 10); });
  document.addEventListener("keyup", (e) => { if (e.shiftKey && e.key.startsWith("Arrow")) showSelbar(); });
  document.addEventListener("selectionchange", PR.debounce(() => { const s = getSelection(); if (!s || s.isCollapsed) selbar().classList.remove("open"); }, 120));

  PR.selectionAction = function (kind, color) {
    if (!pendingSel) return;
    const { anchor, key, lang, quote, prefix, suffix } = pendingSel;
    selbar().classList.remove("open");
    getSelection().removeAllRanges();
    pendingSel = null;
    if (kind === "en") { PR.toggleEn(anchor, true); return; }
    if (kind === "copy") { navigator.clipboard.writeText(quote).then(() => PR.toast("已複製")); return; }
    if (kind === "chat") { PR.chatAsk({ anchor, quote }); return; }
    const note = { anchor, key, lang, quote, prefix, suffix, kind, color: color || "yellow" };
    if (PR.prefs.pen === "underline") note.style = "underline";
    if (kind === "highlight") {
      Object.assign(note, { id: PR.uid("n"), body: "", created: PR.nowIso() });
      PR.saveNote(note);
      PR.applyMarks(anchor);
      PR.toast("已劃線　點劃線可以寫筆記或改顏色", { label: "撤銷", fn: () => { PR.commit({ op: "note_del", id: note.id }); PR.applyMarks(anchor); } }, 2600);
    } else PR.startNote(note);
  };
  selbar().addEventListener("mousedown", (e) => e.preventDefault()); // 點按鈕時別丟掉選區
  selbar().addEventListener("click", (e) => {
    const p = e.target.closest("[data-pen]");
    if (p) {  // 換筆：熒光筆 / 下劃線，記住上次用的
      PR.prefs.pen = p.dataset.pen; PR.applyPrefs();
      PR.$$("[data-pen]", selbar()).forEach((x) => x.classList.toggle("on", x === p));
      PR.$(".dots", selbar()).className = "dots pen-" + p.dataset.pen;
      return;
    }
    const b = e.target.closest("button[data-s]"); if (b) PR.selectionAction(b.dataset.s, b.dataset.color);
  });

  /* 點劃線：寫筆記 / 換顏色 / 刪掉 */
  document.addEventListener("click", (e) => {
    const m = e.target.closest("mark.hl[data-note]");
    if (!m || getSelection().toString()) return;
    const n = (S.reader.notes || {})[m.dataset.note];
    if (!n) return;
    e.stopPropagation();
    if (n.kind !== "highlight") { PR.openNoteEditor(n.id); return; }
    const ul = n.style === "underline";
    PR.popover(m, '<div class="hd">我的劃線</div><div class="hl-edit"><span class="pens"><button data-hl-style="marker" class="' + (ul ? "" : "on") + '" title="熒光筆">' + PR.icon("marker", "sm") + '</button><button data-hl-style="underline" class="' + (ul ? "on" : "") + '" title="下劃線">' + PR.icon("underline", "sm") + "</button></span>" +
      '<span class="dots pen-' + (ul ? "underline" : "marker") + '">' + PR.HL_COLORS.map(([c, name]) =>
      '<button data-hl-color="' + c + '" title="' + name + '" class="dot-' + c + ((n.color || "yellow") === c ? " on" : "") + '"></button>').join("") + "</span></div>" +
      '<div style="display:flex;gap:6px"><button class="btn sm line" data-hl="note">寫筆記</button><button class="btn sm line" data-hl="question">提問</button><button class="btn sm danger" data-hl="del">刪除劃線</button></div>', { sticky: true });
    PR.$("#popover").onclick = (ev) => {
      const c = ev.target.closest("[data-hl-color]"), b = ev.target.closest("[data-hl]");
      if (c) { PR.saveNote(Object.assign({}, n, { color: c.dataset.hlColor })); PR.applyMarks(n.anchor); PR.hidePopover(); return; }
      const sty = ev.target.closest("[data-hl-style]");
      if (sty) { const x = Object.assign({}, n); if (sty.dataset.hlStyle === "underline") x.style = "underline"; else delete x.style; PR.saveNote(x); PR.applyMarks(n.anchor); PR.hidePopover(); return; }
      if (!b) return;
      PR.hidePopover();
      if (b.dataset.hl === "del") { PR.commit({ op: "note_del", id: n.id }); PR.applyMarks(n.anchor); }
      else { PR.saveNote(Object.assign({}, n, { kind: b.dataset.hl })); PR.openNoteEditor(n.id); }
    };
  }, true);
})(window.PR);
