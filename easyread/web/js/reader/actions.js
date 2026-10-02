/* 段落操作：點一下段落出現操作條（在段落右上方），右鍵出完整選單，鍵盤 J/K 移動當前段。
   還有：重譯一段、展開原文、引用和交叉引用的懸停預覽、跳轉。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  let current = null;
  const bar = () => PR.$("#blockbar");

  PR.currentBlock = () => current;
  PR.toggleEn = function (id, force) {
    const host = document.getElementById("b-" + id);
    if (!host) return;
    host.classList.toggle("show-en", force);
    PR.layoutMargin();
    placeBar();
  };

  function actionsFor(id) {
    const b = PR.blockById[id];
    if (!b) return [];
    const keys = PR.blockKeys(b);
    const hasEn = PR.hasZh(b) && (b.en || b.caption_en || (b.items || []).some((i) => i.en));  // 只讀原文、沒譯的塊正文就是英文
    const list = [
      { k: "note", label: "筆記", icon: "note", fn: () => PR.startNote({ anchor: id }) },
      { k: "question", label: "提問", icon: "question", fn: () => PR.startNote({ anchor: id, kind: "question" }) },
    ];
    if (PR.canChat() && PR.feature("chat")) list.push({ k: "chat", label: PR.chatOpen && PR.chatOpen() ? "引用到對話" : "問 AI", icon: "sparkle", fn: () => PR.chatAsk({ anchor: id }) });
    if (hasEn && PR.feature("en")) list.push({ k: "en", label: "原文", icon: "en", fn: () => PR.toggleEn(id) });
    if (keys.length && PR.feature("edit")) list.push({ k: "edit", label: "改譯文", icon: "edit", fn: () => { const zh = PR.$("#b-" + CSS.escape(id) + " .zh[data-key]"); zh && PR.editZh(zh); } });
    if (b.page && PR.feature("pages")) list.push({ k: "page", label: "原頁 p." + b.page, icon: "page", fn: () => PR.openPage(b.page, id) });
    // 重譯花 token、容易誤點：預設關，開了也只放在“⋯”選單裡
    if (keys.length && PR.canAsk() && PR.feature("retranslate")) list.push({ k: "redo", label: "讓模型重譯這段…", icon: "redo", menuOnly: true, fn: () => retranslate(id) });
    list.forEach((a) => { a.kbd = PR.keyOf ? PR.keyOf(a.k) : ""; });
    return list;
  }

  PR.setCurrent = function (id, opts) {
    PR.$$("#paper .blk.current").forEach((x) => x.classList.remove("current"));
    current = id && PR.blockById[id] ? id : null;
    if (!current) { PR.hideBlockbar(); return; }
    const el = document.getElementById("b-" + current);
    el.classList.add("current");
    if (opts && opts.scroll) PR.centerOn(el);  // J/K：放到螢幕中間
    if (!opts || opts.bar !== false) showBar();
    if (PR.syncPage && PR.$(".pv-follow input").checked) PR.syncPage(true);
  };

  function showBar() {
    const acts = actionsFor(current).filter((a) => !a.menuOnly);
    bar().innerHTML = acts.map((a, i) => '<button data-i="' + i + '" title="' + a.label + (a.kbd ? "（" + a.kbd + "）" : "") + '">' + PR.icon(a.icon, "sm") + "<span>" + PR.esc(a.label) + "</span></button>").join("") +
      '<button data-i="more" title="更多（右鍵段落也可以）">⋯</button>';
    bar().onclick = (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      if (b.dataset.i === "more") return blockMenu(current, b);
      PR.hideBlockbar();
      acts[+b.dataset.i].fn();
    };
    bar().classList.add("open");
    placeBar();
  }
  function placeBar() {
    if (!current || !bar().classList.contains("open")) return;
    const el = document.getElementById("b-" + current);
    if (!el) return PR.hideBlockbar();
    const r = el.getBoundingClientRect(), w = bar().offsetWidth;
    const top = r.top - bar().offsetHeight - 6;
    if (r.bottom < 60 || r.top > innerHeight) { bar().classList.remove("open"); return; }
    bar().style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w + 8)) + "px";
    bar().style.top = Math.max(58, top) + "px";
  }
  PR.hideBlockbar = () => bar().classList.remove("open");
  window.addEventListener("scroll", PR.throttle(placeBar, 30), { passive: true });
  window.addEventListener("resize", placeBar);

  function blockMenu(id, where) {
    const b = PR.blockById[id];
    const items = actionsFor(id).map((a) => ({ label: a.label, icon: a.icon, kbd: a.kbd, fn: a.fn }));
    items.push("-",
      { label: "複製譯文", icon: "copy", kbd: PR.keyOf("copy"), fn: () => copyBlock(id, "zh") },
      { label: "複製英文原文", icon: "copy", fn: () => copyBlock(id, "en") },
      // 貼進 Obsidian / Notion 是一條 Markdown 連結，點開（EasyRead 開著時）直接回到這一段
      { label: "複製段落連結（貼進筆記軟體）", icon: "link", fn: () => {
        const sec = PR.sectionOf ? PR.sectionOf(id) : "";  // 用“論文 · 章節 · 頁碼”當連結文字，正文裡可能有公式，不好截
        const title = [(S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "論文", sec, b && b.page ? "p." + b.page : ""].filter(Boolean).join(" · ");
        navigator.clipboard.writeText("[" + title.replace(/[[\]]/g, "") + "](" + location.origin + location.pathname + "#b-" + id + ")").then(() => PR.toast("已複製 Markdown 連結，貼進筆記裡點開就回到這一段"));
      } });
    if (b && PR.blockKeys(b).some((k) => PR.editOf(k))) items.push("-", { label: "恢復譯者稿", icon: "redo", fn: () => { PR.blockKeys(b).forEach((k) => PR.editOf(k) && PR.commit({ op: "edit", block: k, zh: null })); PR.renderBlock(id); PR.applyMarks(id); } });
    PR.menu(where, items);
  }
  function copyBlock(id, lang) {
    const b = PR.blockById[id];
    const t = lang === "en" ? (b.en || b.caption_en || (b.items || []).map((i) => i.en).join("\n")) : PR.blockKeys(b).map(PR.textFor).join("\n");
    navigator.clipboard.writeText(PR.plain(t || (b.tex ? "$$" + b.tex + "$$" : ""))).then(() => PR.toast("已複製"));
  }

  /* 點選段落 = 設為當前段並出操作條；再點一次收起 */
  document.addEventListener("click", (e) => {
    if (e.target.closest("#blockbar, #selbar, #popover, .menu")) return;
    const blk = e.target.closest("#paper .blk");
    if (!blk || e.target.closest("a, button, textarea, mark, .editor-wrap, input") || getSelection().toString()) {
      if (!blk && !e.target.closest("#margin, #notespanel, #pageview, .topbar")) PR.setCurrent(null);
      return;
    }
    if (current === blk.dataset.id && bar().classList.contains("open")) PR.hideBlockbar();
    else PR.setCurrent(blk.dataset.id);
  });
  document.addEventListener("contextmenu", (e) => {
    const blk = e.target.closest("#paper .blk");
    if (!blk || getSelection().toString() || e.target.closest("textarea")) return;
    e.preventDefault();
    PR.setCurrent(blk.dataset.id, { bar: false });
    blockMenu(blk.dataset.id, { x: e.clientX, y: e.clientY });
  });

  /* 段落裡的按鈕：頁碼、角標、過期提示 */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-t]");
    if (!t || !t.closest("#paper")) return;
    const host = t.closest(".blk");
    const id = host && host.dataset.id;
    const b = PR.blockById[id];
    if (t.dataset.t === "page" && b) PR.openPage(b.page, id);
    if (t.dataset.t === "pin") host.classList.toggle("notes-open");
    if (t.dataset.t === "stale") PR.showStale(t.closest(".zh"));
    if (t.dataset.t === "retry-failed") PR.api("/api/p/" + PR.pid + "/translate", { method: "POST", body: { failed: true } }).then(() => { PR.toast("正在重試，譯好後自動替換"); PR.poll(); });
    if (t.dataset.t === "translate-en") PR.api("/api/p/" + PR.pid + "/translate", { method: "POST", body: { en: true } }).then(() => { PR.toast("已開始翻譯，譯好的頁就地換成中文，筆記和劃線都保留"); PR.poll(); });
    if (t.dataset.t === "read-rest") PR.api("/api/p/" + PR.pid + "/translate", { method: "POST", body: { read: true } }).then(() => { PR.toast("已開始整理，整理好的頁會自動出現"); PR.poll(); });
    if (t.dataset.t === "translate-rest") PR.api("/api/p/" + PR.pid + "/translate", { method: "POST", body: {} }).then(() => { PR.toast("已開始翻譯，譯好的頁會自動出現"); PR.poll(); });
  });

  /* ---------- 重譯 ---------- */
  function retranslate(id) {
    const el = document.getElementById("b-" + id);
    PR.popover(el.querySelector(".zh") || el, '<div class="hd">讓模型重譯這段</div>' +
      '<textarea class="input" id="rtHint" rows="3" placeholder="哪裡譯得不好？比如“standard error 應譯標準誤差”“太生硬”（可留空）"></textarea>' +
      '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn sm" data-rt="cancel">取消</button><button class="btn sm accent" data-rt="go">重譯</button></div>', { sticky: true, wide: true });
    setTimeout(() => PR.$("#rtHint").focus(), 30);
    PR.$("#popover").onclick = async (ev) => {
      const b = ev.target.closest("[data-rt]");
      if (!b) return;
      const hint = PR.$("#rtHint").value.trim();
      PR.hidePopover();
      if (b.dataset.rt !== "go") return;
      el.classList.add("busy");
      try {
        for (const key of PR.blockKeys(PR.blockById[id])) await PR.ask("retranslate", { key, hint });
        PR.toast("正在重譯，好了會自動替換（你改過的段落會提示對比）");
      } catch (err) { el.classList.remove("busy"); PR.toast("沒能提交：" + PR.esc(err.message)); }
    };
  }
  PR.on("job-finished", (j) => {
    if (j.kind !== "retranslate") return;
    const id = (j.key || "").split("#")[0];
    const el = document.getElementById("b-" + id);
    el && el.classList.remove("busy");
    if (j.state === "error") PR.toast("重譯失敗：" + PR.esc(j.message));
    else { PR.toast("這段已重譯"); setTimeout(() => { const n = document.getElementById("b-" + id); n && n.classList.add("flash"); }, 300); }
  });

  /* ---------- 引用、交叉引用懸停 ---------- */
  let hoverT = null;
  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest && e.target.closest("a.cite, a.xref");
    if (!a) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => PR.popover(a, refCard(a)), 180);
  });
  document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest("a.cite, a.xref")) { clearTimeout(hoverT); PR.hidePopoverSoon(); } });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.cite, a.xref");
    if (!a) return;
    e.preventDefault();
    PR.hidePopover();
    PR.jumpTo(a.classList.contains("cite") ? "ref-" + a.dataset.ref : "b-" + PR.xindex[a.dataset.kind][a.dataset.key]);
  });
  function refCard(a) {
    if (a.classList.contains("cite")) {
      const r = PR.refById[a.dataset.ref];
      return r ? '<div class="ref"><span class="n">[' + PR.esc(r.id) + "]</span>" + PR.esc(r.text) + "</div>" : "";
    }
    const b = PR.blockById[PR.xindex[a.dataset.kind][a.dataset.key]];
    if (!b) return "";
    if (b.type === "math") return '<div class="hd">公式 (' + PR.esc(b.tag) + ") · 第 " + b.page + ' 頁</div><div class="eq">' + PR.tex(b.tex, true) + "</div>";
    if (b.type === "table" || b.type === "figure") return '<div class="hd">第 ' + b.page + ' 頁</div><div class="cap">' + PR.md(PR.textFor(b.id + "#caption"), { xref: false }) + "</div>";
    return '<div class="hd">跳到</div><div class="cap">' + PR.esc((b.num ? b.num + "　" : "") + PR.plain(PR.textFor(b.id))) + "</div>";
  }

  /* 所有跳轉都用這個：目標放在螢幕正中（比一屏還高的才頂到上面），不被頂欄擋住 */
  PR.centerOn = function (el, instant) {
    const r = el.getBoundingClientRect(), bar = (PR.$("#bar") || {}).offsetHeight || 0;
    const room = innerHeight - bar;
    const top = r.height > room * 0.85 ? r.top - bar - 16 : r.top - bar - (room - r.height) / 2;
    window.scrollTo({ top: scrollY + top, behavior: instant ? "auto" : "smooth" });
  };

  /* opts：noBack 不記返回點；instant 不要動畫；noFlash 不閃 */
  PR.jumpTo = function (domId, opts) {
    const el = document.getElementById(domId);
    if (!el) return;
    opts = opts || {};
    if (!opts.noBack && PR.rememberSpot) PR.rememberSpot(el);  // 跳得遠就記下原處，好回去
    PR.centerOn(el, opts.instant);
    if (!opts.noFlash) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
    history.replaceState(history.state, "", "#" + domId);
  };

  /* 當前段的鍵盤操作 */
  PR.blockAction = function (name) {
    const ids = PR.$$("#paper > .blk").map((x) => x.dataset.id);
    if (name === "next" || name === "prev") {
      const d = name === "next" ? 1 : -1;
      let i = ids.indexOf(current);
      if (i < 0) i = ids.indexOf(PR.readingBlock()) - (d > 0 ? 1 : 0);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + d))];
      PR.setCurrent(next, { scroll: true });
      return true;
    }
    const id = current || PR.readingBlock();
    const act = actionsFor(id).find((a) => a.k === name);
    if (act) { PR.setCurrent(id, { bar: false }); act.fn(); return true; }
    if (name === "copy" && PR.blockById[id]) { copyBlock(id, "zh"); return true; }
    return false;
  };
})(window.PR);
