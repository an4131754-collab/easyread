/* 頂欄、閱讀設定（字號/版心/行距用滑桿，= - 鍵也能調）、左側抽屜（目錄/術語/說明）、懸浮卡。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;

  /* ---------- 偏好 ---------- */
  const DEF = Object.assign({ theme: "auto" }, PR.TYPE_DEFAULTS);
  PR.prefs = Object.assign({}, DEF, PR.ls.get("easyread-prefs", {}));
  PR.applyPrefs = function () {
    const p = PR.prefs, root = document.documentElement;
    root.style.setProperty("--fs", p.fs + "px");
    root.style.setProperty("--lh", p.lh);
    root.style.setProperty("--measure", p.measure + "em");
    PR.applyTheme(p.theme);
    body.classList.toggle("font-sans", p.font === "sans");
    body.classList.toggle("mode-bi", p.mode === "bi");
    body.classList.toggle("no-margin", !p.margin);
    PR.$$("#bar .seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === p.mode));
    PR.ls.set("easyread-prefs", Object.assign(PR.ls.get("easyread-prefs", {}), p));
    if (PR.store.mode === "server") PR.savePrefs("reader", p);
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => PR.applyPrefs());
  const relayout = PR.debounce(() => { PR.fitWide(); PR.renderMargin(); PR.syncPage && PR.syncPage(true); }, 60);
  PR.setPref = function (k, v, quiet) {
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    PR.prefs[k] = v;
    PR.applyPrefs();
    if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);  // 調字號時閱讀位置不跳
    if (!quiet) PR.renderSettings();
    else syncSettings();
    relayout();
  };
  PR.bumpFont = (d) => { PR.setPref("fs", Math.min(28, Math.max(13, PR.prefs.fs + d)), true); PR.toast("字號 " + PR.prefs.fs + " px", null, 900); };

  function segHtml(key, opts) {
    return '<div class="seg">' + opts.map(([v, label]) => '<button data-p="' + key + '" data-v="' + v + '" class="' + (String(PR.prefs[key]) === String(v) ? "on" : "") + '">' + label + "</button>").join("") + "</div>";
  }
  function slider(key, label, min, max, step, unit) {
    return '<div class="row slider"><span>' + label + '</span><input type="range" data-r="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + PR.prefs[key] + '"><b data-rv="' + key + '">' + PR.prefs[key] + unit + "</b></div>";
  }
  PR.renderSettings = function () {
    PR.$("#settings").innerHTML =
      slider("fs", "字號", 13, 28, 1, " px") + slider("measure", "版心", 26, 50, 1, " 字") + slider("lh", "行距", 1.5, 2.4, 0.05, "") +
      '<div class="row"><span>顯示</span>' + segHtml("mode", [["zh", "譯文"], ["bi", "對照"]]) + "</div>" +
      '<div class="row"><span>字型</span>' + segHtml("font", [["serif", "宋體"], ["sans", "黑體"]]) + "</div>" +
      '<div class="row"><span>邊注</span>' + segHtml("margin", [[true, "顯示"], [false, "收起"]]) + "</div>" +
      '<div class="row hintrow"><button class="linkish" data-reset-type>恢復預設</button><span class="grow"></span>' +
      (PR.store.mode === "server" ? '<button class="linkish" data-open-settings="reading">更多設定…</button>' : "") + "</div>";
  };
  function syncSettings() {
    PR.$$("#settings [data-r]").forEach((r) => { r.value = PR.prefs[r.dataset.r]; });
    PR.$$("#settings [data-rv]").forEach((b) => { const k = b.dataset.rv; b.textContent = PR.prefs[k] + ({ fs: " px", measure: " 字" }[k] || ""); });
  }
  PR.$("#settings").addEventListener("input", (e) => {
    const r = e.target.closest("[data-r]");
    if (r) PR.setPref(r.dataset.r, +r.value, true);
  });
  PR.$("#settings").addEventListener("click", (e) => {
    const os = e.target.closest("[data-open-settings]");
    if (os) { PR.$("#settings").classList.remove("open"); return PR.openSettings(os.dataset.openSettings); }
    if (e.target.closest("[data-reset-type]")) return PR.resetAllType();
    const b = e.target.closest("[data-p]");
    if (!b) return;
    let v = b.dataset.v;
    if (b.dataset.p === "margin") v = v === "true";
    PR.setPref(b.dataset.p, v);
  });
  /* 排版全部回到預設（主題不動）；opts 傳進來就用它（設定裡改過的預設值） */
  PR.resetAllType = function (vals) {
    Object.assign(PR.prefs, vals || PR.TYPE_DEFAULTS);
    PR.setPref("fs", PR.prefs.fs);
    if (!vals) PR.toast("排版已恢復預設", null, 1200);
  };
  PR.resetType = () => { ["fs", "measure", "lh"].forEach((k) => (PR.prefs[k] = DEF[k])); PR.setPref("fs", DEF.fs, true); PR.toast("已恢復預設字號和版心", null, 1200); };

  /* ---------- 頂欄 ---------- */
  PR.$("#backBtn").innerHTML = PR.icon("back", "sm") + PR.logo();
  /* 線上演示：左上角回演示主頁，頂欄多一個“線上演示”標記 */
  PR.setupDemo = function () {
    if (!S.demo) return;
    const back = PR.$("#backBtn");
    back.href = S.demo.home || "../"; back.title = "EasyRead 主頁"; back.style.display = "";
    const pill = PR.el("a", { class: "demo-pill", href: S.demo.repo, target: "_blank", rel: "noopener", title: "這是線上演示；在 GitHub 上免費下載，裝到自己電腦" }, "線上演示<span> · 免費下載</span>");
    PR.$("#bar .save-state").before(pill);
  };
  PR.$('[data-act="drawer"]').innerHTML = PR.icon("menu");
  PR.$('[data-act="pages"]').innerHTML = PR.icon("page", "sm") + "<span>原頁</span>";
  PR.$('[data-act="pages"]').addEventListener("mouseenter", () => PR.preloadPage && PR.preloadPage());  // 滑鼠移過去就開始載入
  PR.$('[data-act="notes"]').innerHTML = PR.icon("note", "sm") + "<span>筆記</span>";
  PR.$('[data-act="chat"]').innerHTML = PR.icon("sparkle", "sm") + "<span>問 AI</span>";
  /* 設定裡關掉的功能：頂欄按鈕也藏起來 */
  PR.applyFeatures = function () {
    const set = (sel, on) => { const el = PR.$(sel); if (el) el.style.display = on ? "" : "none"; };
    set('[data-act="pages"]', PR.feature("pages"));
    set('[data-act="chat"]', PR.feature("chat") && PR.chatView());
    if (!PR.feature("pages") && PR.side === "pages") PR.openSide(null);
    if (!PR.feature("chat") && PR.side === "chat") PR.openSide(null);
  };
  PR.on("ui-changed", () => { PR.applyFeatures(); PR.hideBlockbar && PR.hideBlockbar(); PR.renderMargin && PR.renderMargin(); });
  PR.$("#bar").addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) return PR.setPref("mode", m.dataset.mode);
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const act = a.dataset.act;
    if (act === "drawer") PR.toggleDrawer();
    if (act === "pages") PR.togglePages();
    if (act === "notes") PR.toggleNotesPanel();
    if (act === "chat") PR.toggleChat();
    if (act === "settings") { PR.renderSettings(); PR.$("#settings").classList.toggle("open"); }
    if (act === "about") PR.toggleDrawer(true, "about");
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#settings, [data-act=settings]")) PR.$("#settings").classList.remove("open");
    if (!e.target.closest("#popover, a.cite, a.xref, mark.hl, .stale-tag, #blockbar")) PR.hidePopover();
  });
  PR.on("status", ({ s, text }) => {
    const el = PR.$(".save-state");
    el.dataset.s = s;
    el.querySelector("span").textContent = text;
    el.title = s === "saved" ? "修改已寫入 reader.json" : text;
  });
  PR.renderJobState = function () {
    const j = S.job || {};
    const el = PR.$("#jobState");
    if (["queued", "running"].includes(j.state)) el.innerHTML = '<span class="spin"></span> ' + PR.esc(j.message || "翻譯中") + (j.total ? " " + j.done + "/" + j.total : "");
    else if (j.state === "error") el.innerHTML = '<span class="err" title="' + PR.esc(j.error || "") + '">' + (j.read ? "整理原文" : "翻譯") + "出錯</span>";
    else if (j.state === "partial") el.innerHTML = '<span class="err" title="' + PR.esc(j.error || "") + '">' + Object.keys(j.failed || {}).length + " 頁沒" + (j.read ? "整理" : "譯") + "成功</span>";
    else el.innerHTML = "";
  };

  /* ---------- 抽屜 ---------- */
  let tab = "toc";
  PR.toggleDrawer = function (force, which) {
    if (which) tab = which;
    const open = force != null ? force : !body.classList.contains("drawer-open");
    body.classList.toggle("drawer-open", open);
    if (open) PR.renderDrawer();
  };
  PR.$("#scrim").onclick = () => PR.toggleDrawer(false);
  if (PR.store.mode !== "server") PR.$('[data-tab="recent"]').hidden = true;  // 離線單檔案版沒有文獻庫
  PR.$(".drawer-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; PR.renderDrawer(); } });

  PR.renderDrawer = function () {
    PR.$$(".drawer-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const box = PR.$(".drawer-body");
    box.innerHTML = ({ toc: tocHtml, terms: termsHtml, about: aboutHtml, recent: recentHtml })[tab]();
    box.className = "drawer-body " + tab;
  };
  /* 最近讀過的論文：不用迴文獻庫就能換一篇 */
  let recent = null;
  function recentHtml() {
    if (!recent) {
      PR.api("/api/library").then((d) => { recent = d.items.filter((i) => i.last_opened).sort((a, b) => String(b.last_opened).localeCompare(String(a.last_opened))).slice(0, 15); if (tab === "recent") PR.renderDrawer(); })
        .catch(() => { recent = []; });
      return '<p class="hint">載入中…</p>';
    }
    return '<nav class="toc recent-list">' + recent.map((i) => '<a href="/read/' + i.id + '" class="l1' + (i.id === PR.pid ? " on" : "") + '"><span class="cnt">' + (i.progress > 0.02 ? Math.round(i.progress * 100) + "%" : "") + "</span>" +
      PR.esc(i.title_zh || i.title_en || "（未命名）") + "</a>").join("") + '</nav><a class="btn sm line" href="/" style="margin-top:12px">開啟文獻庫</a>';
  }
  function countByHeading() {
    const counts = {};
    let cur = "head";
    for (const b of S.paper.blocks || []) {
      if (b.type === "heading" || b.type === "references") cur = b.id;
      const n = ((PR.noteGroups || {})[b.id] || []).length;
      if (n) counts[cur] = (counts[cur] || 0) + n;
    }
    return counts;
  }
  function tocHtml() {
    const counts = countByHeading();
    const cur = PR.currentHeading && PR.currentHeading();
    let html = '<nav class="toc">', app = false;
    for (const h of PR.headings) {
      if (h.appendix && !app) { html += '<div class="group">附錄</div>'; app = true; }
      html += '<a href="#b-' + h.id + '" data-go="' + h.id + '" class="' + (h.level === 2 ? "l2" : "l1") + (cur === h.id ? " on" : "") + '">' +
        (counts[h.id] ? '<span class="cnt">' + counts[h.id] + "</span>" : "") + '<span class="n">' + PR.esc(h.num || "") + "</span>" + PR.esc(PR.plain(PR.textFor(h.id) || h.zh)) + "</a>";
    }
    const done = new Set((S.paper.translation || {}).done_pages || []);
    const miss = ((S.paper.meta || {}).pages || []).filter((p) => !done.has(p.n));
    if (miss.length) html += '<div class="group">' + ((S.job || {}).read || (S.paper.translation || {}).en_pages?.length ? "還沒整理的頁" : "未譯的頁") + '</div>' + miss.map((p) => '<a href="#orig-' + p.n + '" data-go-orig="' + p.n + '" class="l1"><span class="n"></span>原文第 ' + p.n + " 頁</a>").join("");
    return html + "</nav>";
  }
  function termsHtml() {
    const g = S.paper.glossary || [];
    return '<p class="hint" style="margin:0 0 10px">譯法不合心意？改右邊的譯法，再點“替換”，會把正文裡的舊譯法換成新的（記為你的修改，公式不動，隨時可在段落右鍵“恢復譯者稿”）。</p>' +
      (g.length ? '<table class="terms-t">' + g.map((t, i) => "<tr><td>" + PR.esc(t.en) + '</td><td><input class="input term-in" data-i="' + i + '" value="' + PR.esc(t.zh) + '"></td><td><button class="btn sm line" data-term="' + i + '">替換</button></td></tr>').join("") + "</table>" : '<p class="hint">這篇論文還沒有術語表。</p>') +
      '<div class="term-free"><div class="hint" style="margin:14px 0 6px">任意替換</div><div style="display:flex;gap:6px"><input class="input" id="tFrom" placeholder="原譯法"><input class="input" id="tTo" placeholder="新譯法"><button class="btn sm line" data-term="free">替換</button></div></div>';
  }
  function aboutHtml() {
    const tr = S.paper.translation || {};
    const m = S.paper.meta || {};
    const pdf = PR.pdfUrl(1);
    const status = S.demo ? "這是 EasyRead 的線上演示。你在這裡做的劃線和筆記只存在這個瀏覽器裡，別人看不到。裝到自己電腦上，就能匯入任意論文、背景翻譯、邊讀邊問 AI。"
      : PR.store.mode === "server"
      ? "你改的譯文、筆記、劃線寫進論文目錄的 reader.json（每次儲存記日誌，每 10 分鐘留快照）。翻譯方只寫 paper.json 和 discussion.json，不會覆蓋你的內容。"
      : "這是離線單檔案版：修改只存在當前瀏覽器裡。要把修改帶回文獻庫，點“匯出我的修改”得到一個 JSON，再執行 easyread merge。";
    const en = (tr.en_pages || []).length, done = (tr.done_pages || []).length;
    return '<div class="about"><h3>' + (en ? "英文原文" : "譯文") + "</h3><p>" + done + " / " + ((m.pages || []).length) + " 頁" + (en ? "，其中 " + en + " 頁沒有翻譯" : "") + "。" + PR.esc(tr.note || "") + "</p>" +
      "<h3>儲存</h3><p>" + status + "</p>" + (PR.store.pending ? "<p>還有 " + PR.store.pending + " 條修改在等待寫入。</p>" : "") +
      '<div class="row">' + (pdf ? '<a class="btn sm line" href="' + pdf + '" target="_blank" rel="noopener">開啟原 PDF</a>' : "") +
      '<button class="btn sm line" data-x="md">匯出筆記…</button>' + (PR.store.mode === "static" && !S.demo ? '<button class="btn sm line" data-x="ops">匯出我的修改</button>' : "") + "</div>" +
      "<h3>怎麼用</h3><p>點一下段落，上方出現操作條：筆記、提問、問 AI、原文、改譯文、原頁。右鍵段落是完整選單。選中文字可以用四種顏色劃線、寫筆記、提問；開啟問 AI 時，選中的文字可以直接拖進輸入框，一次引用多段。雙擊一段直接改譯文。</p>" +
      "<h3>快捷鍵</h3>" + (PR.keysOn
        ? '<div class="keyrows">' + PR.KEY_ACTIONS.filter(([id, , , , need]) => PR.keymap[id] && (!need || PR.feature(need))).map(([id, label]) => "<kbd>" + PR.esc(PR.keyOf(id)) + "</kbd><span>" + label + "</span>").join("") +
          "<kbd>1–4</kbd><span>選中文字後：四色劃線</span><kbd>Esc</kbd><span>關閉面板、取消選中</span></div>"
        : "<p>快捷鍵已關閉。</p>") +
      '<button class="btn sm line" data-x="keys">設定快捷鍵和功能</button></div>';
  }
  PR.$("#drawer").addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); PR.toggleDrawer(false); PR.jumpTo("b-" + go.dataset.go); return; }
    const og = e.target.closest("[data-go-orig]");
    if (og) { e.preventDefault(); PR.toggleDrawer(false); PR.jumpTo("orig-" + og.dataset.goOrig); return; }
    const t = e.target.closest("[data-term]");
    if (t) {
      let from, to;
      if (t.dataset.term === "free") { from = PR.$("#tFrom").value.trim(); to = PR.$("#tTo").value.trim(); }
      else { const g = S.paper.glossary[+t.dataset.term]; from = g.zh; to = PR.$('.term-in[data-i="' + t.dataset.term + '"]').value.trim(); }
      const n = PR.replaceTerm(from, to, true);
      if (!n) return PR.toast("正文裡沒找到“" + PR.esc(from) + "”");
      PR.confirm({ title: "替換 " + n + " 處？", body: "把正文裡的“" + from + "”換成“" + to + "”。", ok: "替換", at: t })
        .then((ok) => { if (ok) { PR.replaceTerm(from, to); PR.toast("已替換 " + n + " 處"); } });
      return;
    }
    const x = e.target.closest("[data-x]");
    if (x) x.dataset.x === "keys" ? PR.openSettings("keys") : x.dataset.x === "md" ? PR.openExport() : PR.download(x.dataset.x);
  });

  PR.download = function (kind) {
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "論文").replace(/[\\/:*?"<>|]/g, "");
    const text = kind === "ops" ? JSON.stringify(PR.exportOps(), null, 1) : PR.notesMarkdown();
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })), download: stem + (kind === "ops" ? "-我的修改.json" : "-筆記.md") });
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- 懸浮卡 ---------- */
  let popHideT = null, popSticky = false;
  PR.popover = function (anchor, html, opts) {
    if (!html) return;
    clearTimeout(popHideT);
    const pop = PR.$("#popover");
    pop.onclick = null;
    popSticky = !!(opts && opts.sticky);
    pop.classList.toggle("wide", !!(opts && opts.wide));
    pop.innerHTML = html;
    pop.classList.add("open");
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const x = Math.min(innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2));
    let y = r.bottom + 8;
    if (y + h > innerHeight - 10) y = r.top - h - 8;
    pop.style.left = x + "px"; pop.style.top = Math.max(58, y) + "px";
  };
  PR.hidePopover = () => { clearTimeout(popHideT); PR.$("#popover").classList.remove("open"); };
  PR.hidePopoverSoon = () => { if (popSticky) return; clearTimeout(popHideT); popHideT = setTimeout(PR.hidePopover, 220); };
  PR.$("#popover").addEventListener("mouseenter", () => clearTimeout(popHideT));
  PR.$("#popover").addEventListener("mouseleave", () => PR.hidePopoverSoon());
})(window.PR);
