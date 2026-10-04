/* 右側“問 AI”面板：邊讀邊和模型即時對話，回答逐字流出來。
   - 多個對話：頂部點標題展開對話列表，可以新建、切換、改名、刪除（存在論文目錄的 chat.json）。
   - 模型：輸入框左下角切換，名單在“設定 → 模型”裡配（預設 Claude Opus 5.5 / Sonnet 5.5 / GPT）。
   - 上下文：預設帶上你正在讀的段落；可以引用多段——選中文字點“問 AI”、段落操作條的“問 AI”，
     或者把選中的文字直接拖進輸入框，每段一個小標籤，可以逐個去掉。
   - 你的劃線、筆記、問題不會每次都帶；問到“標紅的”“劃線”“我的筆記”時，背景才把對應顏色的標記找出來。
   - 頁邊筆記裡的問題也從這裡回答，答案同時寫成那條筆記的回覆。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const panel = () => PR.$("#chatpanel");
  const st = { loaded: false, threads: [], cur: null, models: [], def: "", model: "", listOpen: false, menuOpen: false, usageOpen: false, limits: null, refs: [], auto: null, noAuto: false, streaming: null, draft: "" };

  PR.canChat = () => PR.store.mode === "server";
  /* 線上演示 / 離線版：帶著對話記錄時可以看，不能問 */
  PR.chatView = () => PR.canChat() || !!(S.chat && (S.chat.threads || []).length);
  PR.chatOpen = () => PR.side === "chat";
  PR.toggleChat = function (force) {
    const open = force != null ? force : PR.side !== "chat";
    PR.openSide(open ? "chat" : null);
    if (open) { autoContext(); load().then(() => { render(); focusInput(); }); render(); }
  };
  const focusInput = () => setTimeout(() => { const t = PR.$("#chatInput"); t && t.focus(); }, 300);

  function autoContext() {
    const id = (PR.currentBlock && PR.currentBlock()) || PR.readingBlock();
    st.auto = PR.blockById[id] ? { anchor: id, quote: "" } : null;
  }
  function addRef(anchor, quote) {
    if (!PR.blockById[anchor]) return false;
    quote = (quote || "").trim();
    if (st.refs.some((r) => r.anchor === anchor && r.quote === quote)) return false;
    st.refs = st.refs.filter((r) => !(r.anchor === anchor && !r.quote && quote)).concat({ anchor, quote });  // 同段先引整段、再選一句：換成那句
    return true;
  }
  /* 這次提問帶哪幾段：手動引用的；沒有就用正在讀的那段 */
  const sendRefs = () => (st.refs.length ? st.refs.slice() : st.auto && !st.noAuto ? [st.auto] : []);

  /* 外部入口：段落操作條、選中文字（都是“加一段引用”），筆記卡片（直接問這一條） */
  PR.chatAsk = function (opts) {
    if (PR.side !== "chat") { PR.openSide("chat"); autoContext(); }
    load().then(() => {
      if (opts.text) return send(opts.text, opts.note, [{ anchor: opts.anchor, quote: opts.quote || "" }]);
      const added = addRef(opts.anchor, opts.quote);
      if (opts.draft) st.draft = opts.draft;
      render(); focusInput();
      if (added && st.refs.length > 1) PR.toast("已引用 " + st.refs.length + " 段", null, 1000);
    });
  };

  async function load(force) {
    if (st.loaded && !force) return;
    if (!PR.canChat()) {
      st.threads = (S.chat && S.chat.threads) || []; st.cur = st.cur || (st.threads[0] || {}).id || null; st.loaded = true;
      return;
    }
    try {
      const d = await PR.api("/api/p/" + PR.pid + "/chat");
      st.threads = d.threads || []; st.models = d.models || []; st.def = d.default; st.limits = d.limits || null;
      if (!st.model || !st.models.some((m) => m.id === st.model)) st.model = st.def;
      if (st.cur && !st.threads.some((t) => t.id === st.cur)) st.cur = null;
      st.loaded = true;
    } catch (e) { PR.toast("讀不到對話記錄：" + PR.esc(e.message)); }
  }
  PR.on("settings-saved", () => { if (st.loaded) load(true).then(render); });

  const thread = () => st.threads.find((t) => t.id === st.cur) || null;
  const modelOf = (id) => st.models.find((m) => m.id === id) || st.models[0] || { label: "模型" };

  function plainTex(t) {
    return (t || "").replace(/\$\$?([^$]*)\$\$?/g, (m, x) => x.replace(/\\([a-zA-Z]+)\s*/g, (y, name) => ({ mu: "μ", sigma: "σ", epsilon: "ε", alpha: "α", beta: "β", theta: "θ", pi: "π", sum: "Σ", mid: "|", succ: "≻", log: "log ", exp: "exp " })[name] || "").replace(/[{}\\^_]/g, ""));
  }
  function ctxLabel(c) {
    if (!c || !PR.blockById[c.anchor]) return "";
    const b = PR.blockById[c.anchor];
    if (b.type === "math" && !c.quote) return (PR.sectionOf ? PR.sectionOf(c.anchor) + " · " : "") + (b.tag ? "公式 (" + b.tag + ")" : "一個公式");
    const text = plainTex(c.quote || PR.textFor(PR.blockKeys(b)[0] || b.id) || b.caption_zh || b.tex || "").replace(/\*\*|`/g, "");  // 先去公式記號再去粗體，不然 $ 已被 PR.plain 去掉、TeX 原樣露出來
    const sec = PR.sectionOf ? PR.sectionOf(c.anchor) : "";
    return (sec ? sec + " · " : "") + "「" + text.slice(0, 18) + (text.length > 18 ? "…" : "") + "」";
  }
  function refChip(r, i, auto) {
    const label = ctxLabel(r);
    const tip = (auto ? "會帶上你正在讀的這段：" : "引用：") + label + "\n想一起問幾段：把正文裡選中的文字拖進來，或點段落上的“問 AI”";
    return '<span class="chip-ctx' + (auto ? " auto" : "") + '" title="' + PR.esc(tip) + '">' + PR.icon(auto ? "book" : "link", "sm") + "<span>" + PR.esc(label) +
      '</span><button data-c="' + (auto ? "noauto" : "unref") + '" data-i="' + i + '" title="不帶這段">×</button></span>';
  }
  function markCounts() {
    const out = {};
    PR.myNotes().forEach((n) => { if (n.quote) out[n.color || "yellow"] = (out[n.color || "yellow"] || 0) + 1; });
    return out;
  }
  const colorName = (c) => (PR.HL_COLORS.find(([k]) => k === c) || [c, c])[1];
  const when = (iso) => (iso ? PR.shortTime(iso) : "");

  /* ---------- 畫面 ---------- */
  function headHtml() {
    const t = thread();
    return '<div class="ch-head"><button class="ch-title" data-c="list" title="全部對話">' + PR.icon("menu", "sm") + "<span>" + PR.esc(t ? t.title : "新對話") + "</span>" + PR.icon("chevron", "sm") + "</button>" +
      '<span class="grow"></span><button class="btn icon" data-c="new" title="新對話">' + PR.icon("plus", "sm") + '</button><button class="btn icon" data-c="close" title="關閉">×</button></div>' +
      (st.listOpen ? listHtml() : "");
  }
  function listHtml() {
    const rows = st.threads.map((t) => '<div class="ch-thread' + (t.id === st.cur ? " on" : "") + '" data-t="' + PR.esc(t.id) + '"><div class="tt">' + PR.esc(t.title) + "</div>" +
      '<div class="tm">' + Math.round((t.messages || []).length / 2) + " 問 · " + PR.esc(when(t.updated)) + "</div>" +
      '<button class="tx" data-c="rename" title="改名">' + PR.icon("edit", "sm") + '</button><button class="tx" data-c="del" title="刪除">' + PR.icon("trash", "sm") + "</button></div>").join("");
    return '<div class="ch-list"><button class="ch-thread newt" data-c="new">' + PR.icon("plus", "sm") + "新對話</button>" + (rows || '<div class="hint" style="padding:10px 12px">還沒有對話。</div>') + "</div>";
  }
  function msgHtml(m) {
    if (m.role === "user") {
      return '<div class="cm user"><div class="bubble">' + PR.esc(m.content).replace(/\n/g, "<br>") + "</div>" +
        ((m.refs && m.refs.length ? m.refs : m.anchor ? [m] : []).filter((r) => PR.blockById[r.anchor])
          .map((r) => '<button class="cm-ctx" data-c="go" data-anchor="' + PR.esc(r.anchor) + '">' + PR.icon("link", "sm") + "<span>" + PR.esc(ctxLabel(r)) + "</span></button>").join("")) + "</div>";
    }
    const live = st.streaming && st.streaming.msg === m;
    return '<div class="cm ai' + (m.error ? " err" : "") + '" data-id="' + PR.esc(m.id || "") + '"><div class="who"><span class="av">' + PR.icon("sparkle", "sm") + "</span>" + PR.esc(m.model || "AI") + (live ? ' <span class="spin"></span>' : "") + "</div>" +
      '<div class="body">' + (m.error ? PR.esc(m.error) : m.content ? PR.mdBlocks(m.content) : '<p class="thinking"><i></i><i></i><i></i></p>') + "</div>" +
      (!live && !m.error && m.id ? '<div class="acts"><button data-c="copy">' + PR.icon("copy", "sm") + "複製</button>" + (PR.canChat() ? '<button data-c="pin" title="作為 AI 討論放到這段旁邊">' + PR.icon("note", "sm") + "放到頁邊</button>" : "") +
        (m.usage && m.usage.calls ? '<span class="cm-usage" title="輸入 ' + PR.fmtTokens(m.usage.input) + "（快取命中 " + PR.fmtTokens(m.usage.cached) + "），輸出 " + PR.fmtTokens(m.usage.output) + '">' + PR.fmtTokens(m.usage.input + m.usage.output) + " token</span>" : "") + "</div>" : "") + "</div>";
  }
  function emptyHtml() {
    return '<div class="ch-empty"><p>準備好了，隨時等你。</p></div>';
  }
  function composerHtml() {
    if (!PR.canChat()) {
      const repo = (S.demo && S.demo.repo) || "https://github.com/Edwardxlai/easyread";
      return '<div class="ch-compose ch-readonly"><b>這是演示裡的對話記錄，這裡不能提問</b><span>裝到自己電腦上之後，邊讀邊問 Claude、GPT 或免費模型；可以引用多段，問“我標紅的那些”也能找到。</span>' +
        '<a class="btn sm accent" href="' + repo + '" target="_blank" rel="noopener">去 GitHub 安裝 ↗</a></div>';
    }
    const m = modelOf(st.model);
    const chips = st.refs.length ? st.refs.map((r, i) => refChip(r, i)).join("") : st.auto && !st.noAuto ? refChip(st.auto, 0, true) : "";
    const menu = st.menuOpen ? '<div class="ch-menu">' + st.models.map((x) => '<button data-c="model" data-m="' + PR.esc(x.id) + '" class="' + (x.id === st.model ? "on" : "") + '"' + (x.ready === false ? ' disabled title="' + PR.esc(x.hint) + '"' : "") + ">" +
      "<b>" + PR.esc(x.label) + "</b><small>" + PR.esc(x.ready === false ? x.hint : [x.source, x.id === st.def ? "預設" : ""].filter(Boolean).join(" · ")) + "</small></button>").join("") +
      '<hr><button data-c="manage">' + PR.icon("gear", "sm") + "管理模型…</button></div>" : "";
    return '<div class="ch-compose">' + (chips ? '<div class="ch-chips">' + chips + "</div>" : "") +
      '<textarea id="chatInput" rows="1" placeholder="問點什麼…">' + PR.esc(st.draft) + "</textarea>" +
      '<div class="ch-bar"><button class="ch-model" data-c="menu" title="換模型">' + PR.esc(m.label) + PR.icon("chevron", "sm") + "</button>" + menu +
      '<span class="grow"></span>' + PR.usageChip(st.limits, thread() && thread().messages, st.usageOpen) +
      (st.usageOpen ? PR.usagePop(st.limits, thread() && thread().messages) : "") + (st.streaming ? '<button class="ch-send stop" data-c="stop" title="停止">' + PR.icon("stop", "sm") + "</button>"
        : '<button class="ch-send" data-c="send" title="傳送（Enter）；換行用 Shift+Enter">' + PR.icon("arrowUp", "sm") + "</button>") + "</div></div>";
  }
  function render() {
    const el = panel();
    if (!el) return;
    const ta = PR.$("#chatInput");
    if (ta) st.draft = ta.value;
    const t = thread();
    const msgs = t ? t.messages || [] : [];
    el.innerHTML = headHtml() + '<div class="ch-scroll" id="chatList">' + (msgs.length ? msgs.map(msgHtml).join("") : st.loaded ? emptyHtml() : '<p class="hint" style="padding:20px">載入中…</p>') + "</div>" + composerHtml();
    const box = PR.$("#chatList");
    box.scrollTop = box.scrollHeight;
    const input = PR.$("#chatInput");
    if (input) PR.autosize(input);
  }
  function renderLive() {
    const node = st.streaming && PR.$("#chatList .cm.ai:last-child .body");
    if (!node) return;
    node.innerHTML = st.streaming.msg.content ? PR.mdBlocks(st.streaming.msg.content) : '<p class="thinking"><i></i><i></i><i></i></p>';
    const box = PR.$("#chatList");
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
  }
  const renderLiveSoon = PR.throttle(renderLive, 60);

  /* ---------- 傳送 ---------- */
  async function send(text, noteId, only) {
    text = (text || "").trim();
    if (!text || st.streaming) return;
    const refs = only || sendRefs();
    const c = refs[0] || null;
    let t = thread();
    if (!t) { t = { id: null, title: text.slice(0, 22), messages: [], updated: PR.nowIso() }; st.threads.unshift(t); }
    const user = { role: "user", content: text, anchor: c ? c.anchor : null, quote: c ? c.quote : "", note: noteId || null, refs };
    const msg = { role: "assistant", content: "", model: modelOf(st.model).label };
    t.messages.push(user, msg);
    const ctrl = new AbortController();
    st.streaming = { ctrl, msg };
    st.draft = ""; st.listOpen = false; st.menuOpen = false;
    if (PR.$("#chatInput")) PR.$("#chatInput").value = "";
    if (noteId) { PR.asking.add(noteId); PR.renderMargin(); }
    render();
    try {
      const res = await fetch("/api/p/" + PR.pid + "/chat", {
        method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "X-Token": PR.token || "" },
        body: JSON.stringify({ thread: t.id, text, anchor: user.anchor, quote: user.quote, refs, note: noteId || null, model: st.model }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "HTTP " + res.status);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.thread && !t.id) { t.id = ev.thread; st.cur = ev.thread; }
          if (ev.model) msg.model = ev.model;
          if (ev.t) { msg.content += ev.t; renderLiveSoon(); }
          if (ev.done) { msg.id = ev.id; if (ev.usage) msg.usage = ev.usage; if (ev.usage && ev.usage.limits) st.limits = { limits: ev.usage.limits, at: Date.now() / 1000 }; }
          if (ev.error) msg.error = ev.error;
        }
      }
    } catch (e) {
      if (e.name === "AbortError") msg.content += "\n\n（已停止）";
      else msg.error = "沒能回答：" + e.message;
    }
    st.streaming = null;
    t.updated = PR.nowIso();
    if (noteId) { PR.asking.delete(noteId); setTimeout(() => PR.poll && PR.poll(), 300); }
    if (!only) { st.refs = []; st.noAuto = false; autoContext(); }  // 問完清掉引用，回到“正在讀”
    render();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#chatpanel")) return;
    const b = e.target.closest("[data-c]");
    if (!b) { if ((st.menuOpen && !e.target.closest(".ch-menu")) || (st.usageOpen && !e.target.closest(".us-pop"))) { st.menuOpen = st.usageOpen = false; render(); } return; }
    const c = b.dataset.c;
    const row = b.closest(".ch-thread[data-t]");
    if (c === "close") return PR.toggleChat(false);
    if (c === "list") { st.listOpen = !st.listOpen; st.menuOpen = false; return render(); }
    if (c === "new") { if (st.streaming) return; st.cur = null; st.listOpen = false; st.model = st.def; st.refs = []; st.noAuto = false; autoContext(); render(); return focusInput(); }
    if (c === "menu") { st.menuOpen = !st.menuOpen; st.listOpen = st.usageOpen = false; return render(); }
    if (c === "usage") { st.usageOpen = !st.usageOpen; st.listOpen = st.menuOpen = false; return render(); }
    if (c === "model") { st.model = b.dataset.m; st.menuOpen = false; return render(); }
    if (c === "manage") { st.menuOpen = false; render(); return PR.openSettings("chat"); }
    if (c === "send") return send(PR.$("#chatInput").value);
    if (c === "stop" && st.streaming) return st.streaming.ctrl.abort();
    if (c === "suggest") return send(b.textContent);
    if (c === "unref") { st.refs.splice(+b.dataset.i, 1); return render(); }
    if (c === "noauto") { st.noAuto = true; return render(); }
    if (c === "go") return PR.jumpTo("b-" + b.dataset.anchor);
    if (c === "rename" && row) {
      const t = st.threads.find((x) => x.id === row.dataset.t);
      const title = await PR.promptText({ title: "對話改名", value: t.title, ok: "改名", at: row });
      if (title) { t.title = title; await PR.api("/api/p/" + PR.pid + "/chat/rename", { method: "POST", body: { thread: t.id, title: t.title } }); render(); }
      return;
    }
    if (c === "del" && row) {
      const t = st.threads.find((x) => x.id === row.dataset.t);
      if (!(await PR.confirm({ title: "刪除這個對話？", body: "「" + t.title + "」。已經放到頁邊的討論不受影響。", ok: "刪除", danger: true, at: row }))) return;
      await PR.api("/api/p/" + PR.pid + "/chat/delete", { method: "POST", body: { thread: t.id } });
      st.threads = st.threads.filter((x) => x !== t);
      if (st.cur === t.id) st.cur = null;
      return render();
    }
    const card = b.closest(".cm.ai");
    const m = card && thread() && thread().messages.find((x) => x.id === card.dataset.id);
    if (c === "copy" && m) navigator.clipboard.writeText(m.content).then(() => PR.toast("已複製"));
    if (c === "pin" && m) {
      try {
        await PR.api("/api/p/" + PR.pid + "/chat/pin", { method: "POST", body: { thread: st.cur, id: m.id } });
        PR.toast("已放到頁邊"); setTimeout(() => PR.poll && PR.poll(), 200);
      } catch (err) { PR.toast("沒放成：" + PR.esc(err.message)); }
    }
  });
  document.addEventListener("click", (e) => {  // 點對話列表裡的一行：切過去
    const row = e.target.closest("#chatpanel .ch-thread[data-t]");
    if (!row || e.target.closest("[data-c]")) return;
    st.cur = row.dataset.t; st.listOpen = false;
    const t = thread();
    if (t && t.model && st.models.some((m) => m.id === t.model)) st.model = t.model;
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.id !== "chatInput") return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.target.value); }
    if (e.key === "Escape") e.target.blur();
  });
  document.addEventListener("input", (e) => { if (e.target.id === "chatInput") PR.autosize(e.target); });
  /* 把正文裡選中的文字拖進問 AI 面板：變成一段引用，而不是一堆粘進來的字 */
  let dragRef = null;
  document.addEventListener("dragstart", (e) => {
    const sel = window.getSelection();
    const node = sel && sel.rangeCount && sel.getRangeAt(0).startContainer;
    const host = node && (node.nodeType === 1 ? node : node.parentElement).closest("#paper [id^='b-']");
    dragRef = host ? { anchor: host.id.slice(2), quote: sel.toString().trim().slice(0, 1000) } : null;
    if (dragRef && PR.chatOpen()) panel().classList.add("drop-ok");
  });
  document.addEventListener("dragend", () => { dragRef = null; panel().classList.remove("drop-ok", "drop-on"); });
  panel().addEventListener("dragover", (e) => { if (!dragRef) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; panel().classList.add("drop-on"); });
  panel().addEventListener("dragleave", (e) => { if (!panel().contains(e.relatedTarget)) panel().classList.remove("drop-on"); });
  panel().addEventListener("drop", (e) => {
    if (!dragRef) return;
    e.preventDefault();
    panel().classList.remove("drop-ok", "drop-on");
    const { anchor, quote } = dragRef;
    dragRef = null;
    addRef(anchor, quote);
    render(); focusInput();
  });
  /* 讀到別處時，上下文跟著換成當前段（手動指定的不動） */
  window.addEventListener("scroll", PR.debounce(() => {
    if (!PR.chatOpen() || st.streaming) return;
    const before = st.auto && st.auto.anchor;
    autoContext();
    if ((st.auto && st.auto.anchor) === before || st.refs.length || st.noAuto) return;
    const el = PR.$(".chip-ctx.auto > span");
    if (el && st.auto) { el.textContent = ctxLabel(st.auto); el.parentElement.title = "會帶上你正在讀的這段：" + ctxLabel(st.auto); } else render();
  }, 400), { passive: true });
})(window.PR);
