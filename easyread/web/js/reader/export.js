/* 匯出筆記：勾選要哪些（我的筆記、劃線、我的問題、AI 的回答和解釋、論文筆記、問 AI 的對話），匯出 Markdown。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const KINDS = [
    ["paper", "論文筆記（整篇的感悟）"], ["note", "我的筆記"], ["highlight", "我的劃線"], ["question", "我的問題"],
    ["ai", "AI 的回答和解釋（頁邊）"], ["chat", "問 AI 的對話記錄"], ["quote", "每條附上原文引用"],
  ];

  function counts() {
    const notes = PR.myNotes();
    return {
      paper: (S.reader.paper_note || {}).body ? 1 : 0,
      note: notes.filter((n) => n.kind === "note" || (n.kind !== "question" && n.kind !== "highlight")).length,
      highlight: notes.filter((n) => n.kind === "highlight").length,
      question: notes.filter((n) => n.kind === "question").length,
      ai: (S.discussion.entries || []).length,
    };
  }

  PR.openExport = function () {
    const c = counts();
    const saved = PR.ls.get("easyread-export", { paper: true, note: true, highlight: true, question: true, ai: true, chat: false, quote: true });
    const dlg = PR.$("#readerDlg");
    dlg.querySelector(".dialog").innerHTML = "<h2>匯出筆記</h2><div class=\"exp-opts\">" +
      KINDS.map(([k, l]) => '<label><input type="checkbox" data-exp="' + k + '"' + (saved[k] ? " checked" : "") + ">" + l +
        (c[k] != null ? '<span class="n">' + c[k] + " 條</span>" : "") + "</label>").join("") +
      '</div><p class="hint">匯出成 Markdown，按原文章節順序排，可以直接放進 Obsidian、Notion。</p>' +
      '<div class="actions"><button class="btn" data-exp-close>取消</button><button class="btn primary" data-exp-go>匯出</button></div>';
    dlg.classList.add("open");
  };

  PR.$("#readerDlg").addEventListener("click", async (e) => {
    const dlg = PR.$("#readerDlg");
    if (e.target.closest("[data-exp-close]")) return dlg.classList.remove("open");
    if (!e.target.closest("[data-exp-go]")) return;
    const pick = {};
    PR.$$("[data-exp]", dlg).forEach((i) => (pick[i.dataset.exp] = i.checked));
    PR.ls.set("easyread-export", pick);
    let chat = [];
    if (pick.chat && PR.store.mode === "server") { try { chat = (await PR.api("/api/p/" + PR.pid + "/chat")).messages || []; } catch (err) { /* 沒有就算了 */ } }
    const text = PR.notesMarkdown(pick, chat);
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "論文").replace(/[\\/:*?"<>|]/g, "");
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })), download: stem + "-筆記.md" });
    document.body.appendChild(a); a.click(); a.remove();
    dlg.classList.remove("open");
  });
})(window.PR);
