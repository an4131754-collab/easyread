/* Search rendered original and translated text without rewriting note/Math DOM. */
(function (PR) {
  "use strict";
  const panel = PR.el("section", { class: "reader-nav find-panel", hidden: true, "aria-label": PR.t("搜索") });
  panel.innerHTML = '<input class="input" type="search" aria-label="' + PR.t("搜索原文与译文") + '" placeholder="' + PR.t("搜索原文与译文") + '"><span class="find-count" role="status"></span><button class="btn" data-prev aria-label="' + PR.t("上一个结果") + '">↑</button><button class="btn" data-next aria-label="' + PR.t("下一个结果") + '">↓</button><button class="btn" data-close aria-label="' + PR.t("关闭") + '">×</button>';
  document.body.append(panel);
  const input = panel.querySelector("input"), count = panel.querySelector(".find-count");
  let hits = [], active = -1;
  function paint() {
    count.textContent = hits.length ? (active + 1) + " / " + hits.length : "0 / 0";
    panel.querySelector("[data-prev]").disabled = panel.querySelector("[data-next]").disabled = !hits.length;
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set("reader-find", new Highlight(...hits.map((h) => h.range)));
      CSS.highlights.set("reader-find-active", new Highlight(...(hits[active] ? [hits[active].range] : [])));
    }
  }
  function search() {
    hits = []; active = -1;
    const query = input.value.trim().toLowerCase();
    if (query) {
      // Each block is searched as one stream, so queries can span inline formatting.
      for (const block of PR.$$("#paper > .blk, #paper > .paper-head")) {
        const nodes = [], walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => n.parentElement.closest("button, .katex-mathml, .stale-tag, .inline-notes, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        let text = "";
        for (let node; (node = walker.nextNode());) { nodes.push({ node, start: text.length }); text += node.data; }
        const lower = text.toLowerCase();
        for (let pos = lower.indexOf(query); pos >= 0; pos = lower.indexOf(query, pos + query.length)) {
          const first = nodes.find((n) => n.start + n.node.length > pos);
          const last = nodes.find((n) => n.start + n.node.length >= pos + query.length);
          if (!first || !last) continue;
          const range = document.createRange();
          range.setStart(first.node, pos - first.start); range.setEnd(last.node, pos + query.length - last.start);
          hits.push({ range, block });
        }
      }
    }
    paint();
  }
  function move(step) {
    if (!hits.length) return;
    active = active < 0 ? (step < 0 ? hits.length - 1 : 0) : (active + step + hits.length) % hits.length;
    const hit = hits[active];
    if (!hit.range.getClientRects().length && PR.prefs.mode !== "bi") PR.setTemporaryMode("bi");
    PR.$$("#paper .flash").forEach((el) => el.classList.remove("flash"));
    PR.jumpTo(hit.block.id, { noFlash: true, instant: true });
    paint();
  }
  function close() {
    panel.hidden = true;
    if (PR.findOriginalMode != null) {
      PR.setTemporaryMode(PR.findOriginalMode); PR.findOriginalMode = null;
    }
    if (window.CSS && CSS.highlights) { CSS.highlights.delete("reader-find"); CSS.highlights.delete("reader-find-active"); }
    PR.$("#findBtn").focus();
  }
  function open() { if (panel.hidden) PR.findOriginalMode = PR.prefs.mode; panel.hidden = false; search(); input.focus(); input.select(); }
  PR.$("#findBtn").onclick = open;
  input.oninput = () => { search(); move(1); };
  panel.querySelector("[data-prev]").onclick = () => move(-1);
  panel.querySelector("[data-next]").onclick = () => move(1);
  panel.querySelector("[data-close]").onclick = close;
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !document.querySelector(".dialog-backdrop.open")) { e.preventDefault(); open(); }
    else if (!panel.hidden && (e.key === "Escape" || (e.key === "Enter" && panel.contains(e.target)))) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === "Escape") close(); else move(e.shiftKey ? -1 : 1);
    }
  }, true);
  PR.on("rendered", () => { if (!panel.hidden) search(); });
  PR.on("block-rendered", () => { if (!panel.hidden) search(); });
})(window.PR);
