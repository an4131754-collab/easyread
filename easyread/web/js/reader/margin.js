/* 邊注：共讀討論（discussion.json）和我的筆記（reader.json）。
   寬屏排在正文右側、貼著對應段落；窄屏或開著側面板時收成段尾角標，點開在段落下方。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const KIND_LABEL = { explain: "AI · 解釋", qa: "AI · 問答", insight: "AI · 補充", reply: "AI · 回答你的問題", check: "原文核對提示" };
  const expanded = new Set();
  PR.editingNote = null;
  PR.asking = new Set();   // 正在等模型回答的問題

  PR.myNotes = () => Object.values(S.reader.notes || {}).filter((n) => !n.deleted);
  PR.repliesTo = (nid) => (S.discussion.entries || []).filter((e) => e.reply_to === nid);
  const anchorOf = (a) => (a && (a === "head" || PR.blockById[a]) ? a : "head");
  PR.anchorOfEntry = (e) => anchorOf(e.anchor || (((S.reader.notes || {})[e.reply_to] || {}).anchor));

  /* 按錨點分組：組內按時間，agent 的回覆緊跟在被回覆的筆記後面 */
  function collect() {
    const groups = {};
    const push = (anchor, item) => { item.anchor = anchor; (groups[anchor] = groups[anchor] || []).push(item); };
    const noteById = {};
    const notes = PR.myNotes();
    notes.forEach((n) => (noteById[n.id] = n));
    for (const n of notes) {
      if (n.kind === "highlight" && !(n.body || "").trim() && PR.editingNote !== n.id) continue;
      push(anchorOf(n.anchor), { src: "mine", t: n.created || n.updated || "", data: n });
    }
    for (const e of S.discussion.entries || []) {
      const host = e.reply_to && noteById[e.reply_to];
      push(PR.anchorOfEntry(e), { src: "agent", t: host ? (host.created || "") + "~" + (e.at || "") : e.at || "", data: e });
    }
    for (const list of Object.values(groups)) list.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    return groups;
  }

  function cardHtml(item, editingId) {
    const d = item.data;
    if (item.src === "agent") {
      return '<div class="card agent' + (d.kind === "check" ? " check" : "") + '" data-card="' + PR.esc(d.id) + '" data-anchor="' + PR.esc(item.anchor) + '">' +
        '<div class="lbl"><span>' + (KIND_LABEL[d.kind] || "AI") + '</span><span class="meta">' + PR.shortTime(d.updated || d.at) + "</span></div>" +
        (d.quote ? '<div class="quote">「' + PR.md(d.quote, { cite: false, xref: false }) + "」</div>" : "") +
        (d.title ? '<div class="ttl">' + PR.md(d.title, { xref: false }) + "</div>" : "") +
        (d.q ? '<div class="q">' + PR.md(d.q) + "</div>" : "") +
        '<div class="body">' + PR.mdBlocks(d.body) + "</div>" +
        (PR.store.mode !== "server" ? "" : '<div class="acts">' + (d.reply_to && (S.reader.notes || {})[d.reply_to] && PR.canChat && PR.canChat() ? '<button data-a="regen">重新回答</button>' : "") +
        '<button data-a="adel">刪除</button></div>') + "</div>";
    }
    const answered = PR.repliesTo(d.id).length > 0;
    const asking = PR.asking.has(d.id);
    const lbl = d.kind === "question" ? "我的問題 · " + (answered ? "已回覆" : asking ? "模型思考中" : "待回答") : d.kind === "highlight" ? "我的劃線" : "我的筆記";
    const lost = d.quote && PR.quoteLost && PR.quoteLost(d.id) ? " lost" : "";
    const editing = (editingId !== undefined ? editingId : PR.editingNote) === d.id;
    const askLabel = d.kind === "question" ? (answered ? "追問 AI" : "讓 AI 回答") : "讓 AI 點評";
    const ask = d.kind !== "highlight" && d.body && PR.canChat && PR.canChat() && PR.feature("chat")
      ? '<button data-a="ask" class="ask"' + (asking ? " disabled" : "") + ">" + (asking ? '<span class="spin"></span> 正在回答' : PR.icon("sparkle", "sm") + askLabel) + "</button>" : "";
    const body = editing
      ? '<textarea placeholder="' + (d.kind === "question" ? "想問什麼？可以點“讓模型回答”，也可以留給下次和 agent 討論" : "寫下你的理解、疑問或聯想…（支援 $公式$、**粗體**）") + '">' + PR.esc(d.body || "") + "</textarea>" +
        '<div class="kinds"><button data-k="note" class="' + (d.kind !== "question" ? "on" : "") + '">筆記</button><button data-k="question" class="' + (d.kind === "question" ? "on" : "") + '">問題</button>' +
        colorDots(d) + '<span class="hint">自動儲存 · Esc 收起</span></div>'
      : '<div class="body">' + PR.mdBlocks(d.body) + "</div>" + (ask ? '<div class="ask-row">' + ask + "</div>" : "") +
        '<div class="acts"><button data-a="edit">編輯</button><button data-a="kind">' + (d.kind === "question" ? "改成筆記" : "改成問題") + '</button><button data-a="del">刪除</button></div>';
    return '<div class="card mine' + (editing ? " editing" : "") + (d.color ? " c-" + d.color : "") + '" data-note="' + PR.esc(d.id) + '" data-anchor="' + PR.esc(item.anchor) + '">' +
      '<div class="lbl"><span>' + lbl + '</span><span class="meta">' + PR.shortTime(d.updated || d.created) + "</span></div>" +
      (d.quote ? '<div class="quote' + lost + '">「' + PR.md(d.quote, { cite: false, xref: false }) + "」</div>" : "") + body + "</div>";
  }
  PR.cardHtml = cardHtml;
  PR.collectNotes = collect;
  function colorDots(d) {
    if (!d.quote || d.unmarked) return "";
    return '<span class="dots">' + ["yellow", "green", "blue", "pink"].map((c) =>
      '<button data-color="' + c + '" class="dot-' + c + ((d.color || "yellow") === c ? " on" : "") + '" title="換顏色"></button>').join("") + "</span>";
  }

  PR.marginWide = () => window.matchMedia("(min-width: 1240px)").matches &&
    !document.body.classList.contains("side-open") && !document.body.classList.contains("no-margin");

  PR.renderMargin = function () {
    const groups = collect();
    PR.noteGroups = groups;
    const margin = PR.$("#margin");
    PR.$$(".note-pin, .inline-notes").forEach((n) => n.remove());
    const wide = PR.marginWide();
    margin.innerHTML = "";
    for (const [anchor, items] of Object.entries(groups)) {
      const host = document.getElementById("b-" + anchor);
      if (!host) continue;
      const html = items.map((it) => cardHtml(it)).join("");
      if (wide) margin.insertAdjacentHTML("beforeend", html);
      else {
        const mine = items.every((i) => i.src === "mine");
        host.appendChild(PR.el("button", { class: "note-pin" + (mine ? " mine" : ""), title: "討論與筆記", "data-t": "pin", text: String(items.length) }));
        host.appendChild(PR.el("div", { class: "inline-notes" }, html));
      }
    }
    PR.$$(".card").forEach(prepCard);
    if (wide) PR.layoutMargin();
    PR.emit("margin-rendered");
  };

  function prepCard(card) {
    const body = card.querySelector(".body");
    const id = card.dataset.card || card.dataset.note;
    if (body && !expanded.has(id) && body.scrollHeight > 220) {
      card.classList.add("clamp");
      card.insertAdjacentHTML("beforeend", '<button class="more" data-a="more">展開全文</button>');
    }
    const ta = card.querySelector("textarea");
    if (ta) PR.autosize(ta);
  }

  /* 寬屏：卡片貼著錨點，放不下就往下順延 */
  PR.layoutMargin = function () {
    if (!PR.marginWide()) return;
    const margin = PR.$("#margin");
    const mTop = margin.getBoundingClientRect().top;
    const cards = PR.$$(".card", margin).map((c) => {
      const host = document.getElementById("b-" + c.dataset.anchor);
      let y = host ? host.getBoundingClientRect().top - mTop : 0;
      const mark = c.dataset.note ? PR.$('mark[data-note="' + c.dataset.note + '"]') : PR.$('mark[data-card="' + c.dataset.card + '"]');
      if (mark) y = Math.max(y, mark.getBoundingClientRect().top - mTop - 4);
      return { c, y };
    });
    cards.sort((a, b) => a.y - b.y);
    let bottom = -Infinity;
    for (const { c, y } of cards) {
      const top = Math.max(y, bottom + 16);
      c.style.top = Math.round(top) + "px";
      bottom = top + c.offsetHeight;
    }
    margin.style.minHeight = Math.max(0, bottom) + "px";
  };

  /* ---------- 筆記的增刪改 ---------- */
  const noteById = (id) => (S.reader.notes || {})[id];
  PR.saveNote = function (note) { note.updated = PR.nowIso(); PR.commit({ op: "note", note }); };

  PR.startNote = function (opts) {
    const note = Object.assign({ id: PR.uid("n"), kind: "note", body: "", created: PR.nowIso() }, opts);
    PR.saveNote(note);
    if (PR.notesPanelOpen && PR.notesPanelOpen()) PR.renderNotesPanel(note.id);
    else PR.openNoteEditor(note.id);
    return note;
  };

  PR.openNoteEditor = function (id) {
    if (PR.notesPanelOpen && PR.notesPanelOpen()) { PR.renderNotesPanel(id); return; }
    PR.editingNote = id;
    const n = noteById(id);
    PR.renderMargin();
    PR.applyMarks && PR.applyMarks();
    if (!PR.marginWide() && n) { const host = document.getElementById("b-" + anchorOf(n.anchor)); host && host.classList.add("notes-open"); }
    const ta = PR.$('#margin .card[data-note="' + id + '"] textarea, .inline-notes .card[data-note="' + id + '"] textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      const r = ta.getBoundingClientRect();
      if (r.bottom > innerHeight - 40 || r.top < 70) ta.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  PR.closeNoteEditor = function () {
    const id = PR.editingNote;
    if (!id) return;
    const ta = PR.$('.card[data-note="' + id + '"] textarea');
    const n = noteById(id);
    PR.editingNote = null;
    if (n && ta) PR.finishNote(n, ta.value);
    PR.renderMargin();
    PR.applyMarks && PR.applyMarks();
  };
  /* 結束編輯：空筆記有原話就退回成劃線，沒有就刪掉 */
  PR.finishNote = function (n, value) {
    const body = value.trim();
    if (!body && n.kind !== "highlight") {
      if (n.quote) PR.saveNote(Object.assign({}, n, { kind: "highlight", body: "" }));
      else PR.commit({ op: "note_del", id: n.id });
    } else if (body !== (n.body || "")) PR.saveNote(Object.assign({}, n, { body, kind: n.kind === "highlight" ? "note" : n.kind }));
  };

  PR.autosaveNote = PR.debounce(() => {
    const id = PR.editingNote;
    const ta = id && PR.$('.card[data-note="' + id + '"] textarea');
    const n = id && noteById(id);
    if (ta && n && ta.value.trim() !== (n.body || "")) {
      const copy = Object.assign({}, n, { body: ta.value.trim() });
      if (copy.kind === "highlight" && copy.body) copy.kind = "note";
      PR.saveNote(copy);
    }
  }, 600);

  /* 筆記卡片上的“讓 AI 回答 / 點評 / 追問”：在右側“問 AI”面板裡實時回答，答案同時成為這條筆記的回覆 */
  PR.askModel = function (nid) {
    const n = noteById(nid);
    if (!n) return;
    const answered = PR.repliesTo(nid).length > 0;
    if (n.kind === "question" && answered) return PR.chatAsk({ anchor: n.anchor, quote: n.quote, draft: "" });
    const text = n.kind === "question" ? n.body : "這是我讀這裡時寫的筆記，請點評：我理解得對不對、有沒有漏掉或想錯的地方、還可以往哪想。\n\n我的筆記：" + n.body;
    PR.chatAsk({ anchor: n.anchor, quote: n.quote, text, note: nid });
  };
  PR.on("job-finished", (j) => {
    if (j.kind !== "answer") return;
    PR.asking.delete(j.note);
    if (j.state === "error") PR.toast("模型回答失敗：" + PR.esc(j.message));
    PR.renderMargin(); PR.notesPanelOpen && PR.notesPanelOpen() && PR.renderNotesPanel();
  });

  /* ---------- 卡片上的互動（邊注和筆記面板共用） ---------- */
  document.addEventListener("input", (e) => {
    if (e.target.matches("#margin .card textarea, .inline-notes .card textarea")) { PR.autosize(e.target); PR.autosaveNote(); PR.layoutMargin(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("#margin .card textarea, .inline-notes .card textarea") && (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey)))) {
      e.preventDefault(); PR.autosaveNote.flush(); PR.closeNoteEditor();
    }
  });
  document.addEventListener("focusout", (e) => {
    if (!e.target.matches("#margin .card textarea, .inline-notes .card textarea")) return;
    setTimeout(() => {
      const card = e.target.closest(".card");
      if (!card || !card.isConnected) return;   // 卡片被重排替換掉了，新卡片已接手編輯
      if (card.contains(document.activeElement)) return;
      if (PR.editingNote === card.dataset.note) { PR.autosaveNote.flush(); PR.closeNoteEditor(); }
    }, 150);
  });

  PR.cardClick = function (e, inPanel) {
    const card = e.target.closest(".card");
    if (!card) return false;
    const a = e.target.closest("[data-a]"), k = e.target.closest("[data-k]"), col = e.target.closest("[data-color]");
    const nid = card.dataset.note;
    const rerender = () => (inPanel ? PR.renderNotesPanel(nid) : PR.openNoteEditor(nid));
    if (a && a.dataset.a === "more") { expanded.add(card.dataset.card || nid); card.classList.remove("clamp"); a.remove(); PR.layoutMargin(); return true; }
    if (card.dataset.card && a && (a.dataset.a === "adel" || a.dataset.a === "regen")) { delAgent(card.dataset.card, a.dataset.a === "regen", a); return true; }
    if (nid && a) {
      const n = noteById(nid);
      if (a.dataset.a === "edit") inPanel ? PR.renderNotesPanel(nid) : PR.openNoteEditor(nid);
      else if (a.dataset.a === "ask") PR.askModel(nid);
      else if (a.dataset.a === "kind") { PR.saveNote(Object.assign({}, n, { kind: n.kind === "question" ? "note" : "question" })); inPanel ? PR.renderNotesPanel() : PR.renderMargin(); }
      else if (a.dataset.a === "del") {
        PR.commit({ op: "note_del", id: nid });
        PR.renderMargin(); PR.applyMarks(); inPanel && PR.renderNotesPanel();
        PR.toast("已刪除這條筆記", { label: "撤銷", fn: () => { PR.saveNote(Object.assign({}, n, { deleted: false })); PR.renderMargin(); PR.applyMarks(); inPanel && PR.renderNotesPanel(); } });
      }
      return true;
    }
    if (nid && (k || col)) {
      const n = noteById(nid);
      const ta = card.querySelector("textarea");
      const patch = k ? { kind: k.dataset.k } : { color: col.dataset.color };
      PR.saveNote(Object.assign({}, n, { body: ta ? ta.value.trim() : n.body }, patch));
      PR.applyMarks();
      rerender();
      return true;
    }
    if (nid && e.target.closest(".body") && !e.target.closest("a")) { rerender(); return true; }
    if (card.dataset.anchor && inPanel) { PR.jumpTo("b-" + card.dataset.anchor); return true; }
    return false;
  };
  document.addEventListener("click", (e) => { if (e.target.closest("#margin, .inline-notes")) PR.cardClick(e, false); });

  /* AI 寫的卡片：刪除；回答類的還能重新回答（刪掉舊的，再問一次） */
  async function delAgent(id, regen, btn) {
    const e = (S.discussion.entries || []).find((x) => x.id === id);
    if (!e) return;
    if (!regen && !(await PR.confirm({ title: "刪除這條 AI 內容？", body: "刪了不能撤銷。", ok: "刪除", danger: true, at: btn }))) return;
    try {
      await PR.api("/api/p/" + PR.pid + "/discussion_del", { method: "POST", body: { id } });
    } catch (err) { return PR.toast("刪除失敗：" + PR.esc(err.message)); }
    S.discussion.entries = S.discussion.entries.filter((x) => x.id !== id);
    PR.renderMargin(); PR.applyMarks();
    if (PR.notesPanelOpen && PR.notesPanelOpen()) PR.renderNotesPanel();
    if (regen) PR.askModel(e.reply_to);
  }

  /* 卡片和段落互相高亮 */
  function link(card, on) {
    const host = document.getElementById("b-" + card.dataset.anchor);
    host && host.classList.toggle("linked", on);
    card.classList.toggle("linked", on);
    const sel = card.dataset.note ? 'mark[data-note="' + card.dataset.note + '"]' : 'mark[data-card="' + card.dataset.card + '"]';
    PR.$$(sel).forEach((m) => m.classList.toggle("active", on));
  }
  document.addEventListener("mouseover", (e) => {
    const card = e.target.closest && e.target.closest("#margin .card, #notespanel .card");
    if (card && !card.classList.contains("linked")) { PR.$$(".card.linked").forEach((c) => link(c, false)); link(card, true); }
    if (!card && e.target.closest && !e.target.closest("#margin, #notespanel")) PR.$$(".card.linked").forEach((c) => link(c, false));
  });

  PR.flashCard = function (id) {
    const card = PR.$('.card[data-card="' + id + '"], .card[data-note="' + id + '"]');
    if (!card) return;
    if (!PR.marginWide()) { const host = card.closest(".blk"); host && host.classList.add("notes-open"); }
    card.classList.remove("new"); void card.offsetWidth; card.classList.add("new");
  };
})(window.PR);
