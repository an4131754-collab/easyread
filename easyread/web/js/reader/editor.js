/* 改譯文：雙擊一段或按 E，原地變成編輯框。草稿隨手存在瀏覽器裡，誤關頁面也能找回。 */
(function (PR) {
  "use strict";
  PR.editingKey = null;
  const draftKey = (key) => "pr-draft-" + PR.paperKey + "-" + key;

  PR.editZh = function (zh) {
    if (PR.editingKey) return;
    PR.hideBlockbar && PR.hideBlockbar();
    const key = zh.dataset.key;
    const blockId = zh.closest(".blk").dataset.id;
    const current = PR.textFor(key);
    const draft = PR.ls.get(draftKey(key), null);
    const edited = !!PR.editOf(key);
    PR.editingKey = key;
    const wrapEl = PR.el("div", { class: "editor-wrap" });
    const ta = PR.el("textarea", { class: "editor", spellcheck: "false", "aria-label": "編輯譯文" });
    ta.value = draft != null && draft !== current ? draft : current;
    const bar = PR.el("div", { class: "editor-bar" },
      "<span>" + (draft != null && draft !== current ? "已恢復上次沒儲存的草稿 · " : "") + "Ctrl+Enter 儲存 · Esc 取消 · 支援 $公式$、**粗體**</span>" +
      '<span class="grow"></span>' + (edited ? '<button data-e="revert">恢復譯者稿</button>' : "") +
      '<button data-e="cancel">取消</button><button data-e="save" class="primary">儲存</button>');
    wrapEl.append(ta, bar);
    zh.replaceChildren(wrapEl);
    PR.autosize(ta);
    ta.focus();
    const saveDraft = PR.debounce(() => PR.ls.set(draftKey(key), ta.value), 400);
    ta.addEventListener("input", () => { PR.autosize(ta); saveDraft(); PR.layoutMargin(); });

    const finish = (action) => {
      saveDraft.cancel();
      PR.editingKey = null;
      PR.ls.del(draftKey(key));
      const agent = PR.agentText(key);
      if (action === "save") {
        const text = ta.value.replace(/\s+$/, "");
        if (text === agent) { if (edited) PR.commit({ op: "edit", block: key, zh: null }); }
        else if (text !== current || PR.isStale(key)) PR.commit({ op: "edit", block: key, zh: text, base: PR.hashText(agent) });
      } else if (action === "revert") PR.commit({ op: "edit", block: key, zh: null });
      PR.renderBlock(blockId);
      PR.applyMarks(blockId);
      PR.renderMargin();
    };
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) finish(b.dataset.e); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish("cancel"); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish("save"); }
    });
  };

  document.addEventListener("dblclick", (e) => {
    const zh = e.target.closest("#paper .zh[data-key]");
    if (!zh || e.target.closest("a, button, textarea") || zh.closest(".blk-references")) return;
    getSelection().removeAllRanges();
    PR.$("#selbar").classList.remove("open");
    PR.editZh(zh);
  });

  /* 我改過、譯者稿後來又變了 */
  PR.showStale = function (zh) {
    const key = zh.dataset.key;
    const agent = PR.agentText(key);
    PR.popover(zh, '<div class="hd">譯者稿（更新後）</div><div class="cap">' + PR.md(agent) + "</div>" +
      '<div class="hd" style="margin-top:10px">你的版本</div><div class="cap">' + PR.md(PR.textFor(key)) + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm line" data-st="agent">換成譯者稿</button><button class="btn sm line" data-st="mine">保留我的</button></div>', { sticky: true, wide: true });
    PR.$("#popover").onclick = (ev) => {
      const b = ev.target.closest("[data-st]");
      if (!b) return;
      PR.hidePopover();
      if (b.dataset.st === "agent") PR.commit({ op: "edit", block: key, zh: null });
      else PR.commit({ op: "edit", block: key, zh: PR.textFor(key), base: PR.hashText(agent) });
      const id = key.split("#")[0];
      PR.renderBlock(id); PR.applyMarks(id);
    };
  };

  /* 術語一鍵替換：在我的版本里把舊譯法換成新譯法（寫成我的修改，不動譯者稿） */
  PR.replaceTerm = function (from, to, dryRun) {
    if (!from || from === to) return 0;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const guard = to.startsWith(from) ? "(?!" + to.slice(from.length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")" : "";
    const re = new RegExp(esc + guard, "g");
    let n = 0;
    for (const b of PR.state.paper.blocks || []) {
      for (const key of PR.blockKeys(b)) {
        const cur = PR.textFor(key);
        const parts = cur.split(/(\$[^$]*\$)/);  // 公式裡不替換
        let hits = 0;
        const next = parts.map((p, i) => (i % 2 ? p : p.replace(re, () => { hits++; return to; }))).join("");
        if (!hits) continue;
        n += hits;
        if (!dryRun) PR.commit({ op: "edit", block: key, zh: next, base: PR.hashText(PR.agentText(key)) });
      }
    }
    if (!dryRun && n) PR.rerenderKeepingPlace();
    return n;
  };
})(window.PR);
