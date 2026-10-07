/* 右側筆記面板：全部批註按原文順序排好（可篩選、可就地編輯），以及整篇的“論文筆記”。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  let tab = PR.ls.get("easyread-np-tab", "notes");
  let filter = "all";
  let editing = null;
  let preview = false;
  const panel = () => PR.$("#notespanel");

  PR.notesPanelOpen = () => PR.side === "notes";
  PR.toggleNotesPanel = function (force) {
    const open = force != null ? force : PR.side !== "notes";
    PR.openSide(open ? "notes" : null);
    if (open) PR.renderNotesPanel();
    else editing = null;
  };

  function sectionOf(id) {
    let cur = null;
    for (const b of S.paper.blocks || []) {
      if (b.type === "heading" || b.type === "references") cur = b;
      if (b.id === id) break;
    }
    return cur ? (cur.num ? cur.num + " " : "") + PR.plain(PR.textFor(cur.id) || cur.zh) : "論文開頭";
  }
  PR.sectionOf = sectionOf;

  function items() {
    const replied = new Set((S.discussion.entries || []).map((e) => e.reply_to).filter(Boolean));
    const out = [];
    for (const n of PR.myNotes()) out.push({ src: "mine", anchor: n.anchor || "head", t: n.created || "", data: n });
    for (const e of S.discussion.entries || []) out.push({ src: "agent", anchor: PR.anchorOfEntry(e), t: e.at || "", data: e });
    const keep = {
      all: () => true, mine: (i) => i.src === "mine" && i.data.kind !== "highlight", agent: (i) => i.src === "agent",
      hl: (i) => i.src === "mine" && i.data.quote && !i.data.unmarked, open: (i) => i.src === "mine" && i.data.kind === "question" && !replied.has(i.data.id),
    }[filter];
    const order = (a) => (a === "head" ? -1 : PR.order[a] ?? 1e9);
    return out.filter(keep).sort((a, b) => order(a.anchor) - order(b.anchor) || (a.t < b.t ? -1 : 1));
  }

  PR.renderNotesPanel = function (editId) {
    if (editId !== undefined) { editing = editId; tab = "notes"; }
    const el = panel();
    if (el.contains(document.activeElement) && document.activeElement.matches("textarea") && editId === undefined) return; // 正在打字，不打斷
    const list = items();
    const count = PR.myNotes().length + (S.discussion.entries || []).length;
    let h = '<div class="np-head"><div class="seg"><button data-np="notes" class="' + (tab === "notes" ? "on" : "") + '">批註 ' + count + '</button><button data-np="paper" class="' + (tab === "paper" ? "on" : "") + '">論文筆記</button></div>' +
      '<span class="grow"></span><button class="btn sm" data-np-act="md" title="匯出 Markdown">匯出</button><button class="btn icon" data-np-act="close" title="關閉（M）">×</button></div>';
    if (tab === "paper") {
      const body = (S.reader.paper_note || {}).body || "";
      h += '<div class="np-paper"><div class="np-tools"><span class="hint">整篇的感悟、總結、待辦。自動儲存。</span><span class="grow"></span>' + PR.noteHelpButtons() +
        '<button class="btn sm' + (preview ? " on" : "") + '" data-np-act="preview">' + (preview ? "編輯" : "預覽") + "</button></div>" +
        (preview ? '<div class="np-preview">' + (body ? PR.mdBlocks(body) : '<p class="hint">還沒有寫。</p>') + "</div>"
          : '<textarea id="paperNote" placeholder="讀完這篇，你怎麼看？&#10;&#10;可以寫：核心論點、我同意/不同意的地方、能用到哪裡、還沒搞懂的問題……&#10;支援 $公式$、**粗體**，空行分段。">' + PR.esc(body) + "</textarea>") + PR.noteHelpBox() + "</div>";
    } else {
      const chips = [["all", "全部"], ["mine", "我的筆記"], ["hl", "劃線"], ["agent", "AI"], ["open", "待回答"]]
        .map(([k, l]) => '<button data-nf="' + k + '" class="' + (filter === k ? "on" : "") + '">' + l + "</button>").join("");
      h += '<div class="np-filters">' + chips + '</div><div class="np-add"><button class="btn sm line" data-np-act="add">' + PR.icon("plus", "sm") + "給當前段寫筆記</button></div><div class=\"np-list\">";
      let lastSec = null;
      for (const it of list) {
        const sec = it.anchor === "head" ? "論文開頭" : "第 " + (PR.blockById[it.anchor] || {}).page + " 頁 · " + sectionOf(it.anchor);
        if (sec !== lastSec) { h += '<div class="np-sec">' + PR.esc(sec) + "</div>"; lastSec = sec; }
        h += PR.cardHtml(it, editing);
      }
      if (!list.length) h += '<p class="hint np-empty">' + (filter === "all" ? "還沒有批註。選中正文文字可以劃線、寫筆記、提問；點一下段落也能加筆記。" : "這個分類下沒有內容。") + "</p>";
      h += "</div>";
    }
    el.innerHTML = h;
    PR.$$("textarea", el).forEach(PR.autosize);
    const ta = editing && el.querySelector('.card[data-note="' + editing + '"] textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: "nearest" }); }
  };

  const savePaperNote = PR.debounce(() => { const ta = PR.$("#paperNote"); if (ta) PR.commit({ op: "paper_note", body: ta.value }); }, 600);
  const saveEditing = PR.debounce(() => {
    const ta = editing && panel().querySelector('.card[data-note="' + editing + '"] textarea');
    const n = editing && (S.reader.notes || {})[editing];
    if (ta && n && ta.value.trim() !== (n.body || "")) PR.saveNote(Object.assign({}, n, { body: ta.value.trim(), kind: n.kind === "highlight" && ta.value.trim() ? "note" : n.kind }));
  }, 600);
  function stopEditing() {
    const ta = editing && panel().querySelector('.card[data-note="' + editing + '"] textarea');
    const n = editing && (S.reader.notes || {})[editing];
    saveEditing.cancel();
    if (ta && n) PR.finishNote(n, ta.value);
    editing = null;
    PR.renderNotesPanel();
    PR.applyMarks();
  }

  panel().addEventListener("input", (e) => {
    PR.autosize(e.target);
    if (e.target.id === "paperNote") {
      savePaperNote();
      const btns = PR.$("#notespanel .nh-btns");  // 筆記從空變成有內容（或反過來）：“起草稿”換成“點評 / 幫我改”
      if (btns && (btns.querySelector('[data-nh="draft"]') ? 1 : 0) !== (e.target.value.trim() ? 0 : 1)) btns.outerHTML = PR.noteHelpButtons();
    }
    else if (e.target.matches(".card textarea")) saveEditing();
  });
  panel().addEventListener("keydown", (e) => {
    if (e.target.matches(".card textarea") && (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); stopEditing(); }
  });
  panel().addEventListener("focusout", (e) => {
    if (e.target.id === "paperNote") savePaperNote.flush();
    if (!e.target.matches(".card textarea")) return;
    setTimeout(() => { const card = e.target.closest(".card"); if (card && card.isConnected && !card.contains(document.activeElement) && editing === card.dataset.note) stopEditing(); }, 150);
  });
  panel().addEventListener("click", (e) => {
    const np = e.target.closest("[data-np]");
    if (np) { tab = np.dataset.np; PR.ls.set("easyread-np-tab", tab); return PR.renderNotesPanel(); }
    const nf = e.target.closest("[data-nf]");
    if (nf) { filter = nf.dataset.nf; return PR.renderNotesPanel(); }
    const act = e.target.closest("[data-np-act]");
    if (act) {
      const a = act.dataset.npAct;
      if (a === "close") PR.toggleNotesPanel(false);
      if (a === "md") PR.openExport();
      if (a === "preview") { savePaperNote.flush(); preview = !preview; PR.renderNotesPanel(); }
      if (a === "add") { const id = (PR.currentBlock && PR.currentBlock()) || PR.readingBlock(); if (PR.blockById[id]) PR.startNote({ anchor: id }); }
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    if (card.dataset.note && (e.target.closest(".body") || e.target.closest('[data-a="edit"]')) && !e.target.closest("a")) {
      editing = card.dataset.note; PR.renderNotesPanel(editing); return;
    }
    if (PR.cardClick(e, true)) return;
    if (card.dataset.anchor) { PR.jumpTo("b-" + card.dataset.anchor); if (card.dataset.note) setTimeout(() => PR.$$('mark[data-note="' + card.dataset.note + '"]').forEach((m) => m.classList.add("active")), 400); }
  });

  /* 匯出的 Markdown：論文筆記 + 按原文順序的批註 */
  /* pick：{paper, note, highlight, question, ai, chat, quote}，不傳就全要 */
  PR.notesMarkdown = function (pick, chat) {
    pick = pick || { paper: true, note: true, highlight: true, question: true, ai: true, quote: true };
    const m = S.paper.meta || {};
    const link = m.url || (m.arxiv ? "https://arxiv.org/abs/" + String(m.arxiv).replace(/^arXiv:/i, "").split(/[\sv]/)[0] : "");
    const out = ["# " + (m.title_zh || m.title_en || ""), "", m.title_en ? "*" + m.title_en + "*  " : "", [m.authors, m.date, link].filter(Boolean).join(" · "), ""];
    const pn = (S.reader.paper_note || {}).body;
    if (pick.paper && pn) out.push("## 論文筆記", "", pn, "");
    const want = (it) => it.src === "mine" ? !!pick[it.data.kind === "question" ? "question" : it.data.kind === "highlight" ? "highlight" : "note"] : !!pick.ai;
    const list = (() => { const f = filter; filter = "all"; const r = items().filter(want); filter = f; return r; })();
    if (list.length) out.push("## 批註", "");
    let lastSec = "";
    for (const it of list) {
      const sec = it.anchor === "head" ? "論文開頭" : sectionOf(it.anchor);
      if (sec !== lastSec) { out.push("### " + sec, ""); lastSec = sec; }
      const d = it.data;
      const q = pick.quote && d.quote ? "「" + d.quote + "」" : "";
      if (it.src === "mine") out.push("- **" + ({ question: "我的問題", highlight: "劃線" }[d.kind] || "我的筆記") + "**" + q + (d.body ? "：" + d.body : ""));
      else out.push("- **AI" + (d.kind === "reply" ? " 回答" : "") + (d.title ? "：" + d.title : "") + "**" + q + (d.q ? "（問：" + d.q + "）" : "") + "\n\n  " + (d.body || "").replace(/\n/g, "\n  "));
    }
    if (pick.chat && chat && chat.length) {
      out.push("", "## 問 AI 的對話", "");
      for (const c of chat) out.push(c.role === "user" ? "**我**：" + c.content : "**AI**（" + (c.model || "") + "）：" + c.content, "");
    }
    return out.join("\n");
  };
})(window.PR);
