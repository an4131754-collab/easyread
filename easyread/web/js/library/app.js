/* 文獻庫：列表、篩選、排序、鍵盤操作、狀態輪詢。 */
(function (PR) {
  "use strict";
  const L = (PR.lib = { items: [], view: "all", tag: null, q: "", sort: PR.ls.get("easyread-sort", "opened"), selected: null, engine: "claude" });
  const prefs = PR.ls.get("easyread-prefs", {});
  PR.applyTheme(prefs.theme);


  PR.$("#importBtn").innerHTML = PR.icon("plus", "sm") + "<span>匯入論文</span>";
  PR.$("#settingsBtn").innerHTML = PR.icon("gear");
  PR.$("#helpBtn").innerHTML = PR.icon("question");
  PR.$(".search .si").outerHTML = PR.icon("search", "sm");
  PR.$("#sort").value = L.sort;

  L.byId = (id) => L.items.find((i) => i.id === id);
  L.openReader = (id) => { location.href = "/read/" + id; };
  L.patch = async function (id, fields) {
    const it = L.byId(id);
    if (it) { Object.assign(it, fields.meta_override ? {} : fields); L.render(); }  // 先改介面，再存檔
    try { await PR.api("/api/p/" + id + "/item", { method: "POST", body: fields }); }
    catch (e) { PR.toast("儲存失敗：" + PR.esc(e.message)); }
    await L.load();
  };

  L.load = async function () {
    const d = await PR.api("/api/library");
    PR.token = d.token;
    L.engine = d.engine;
    L.engineLabel = d.engine_label;
    L.firstRun = d.first_run;
    L.version = d.version;
    L.trashCount = d.trash || 0;
    engineChip();
    L.items = d.items;
    L.render();
    schedule();
  };

  let pollT;
  function schedule() {
    clearTimeout(pollT);
    const busy = L.items.some((i) => i.job && ["queued", "running"].includes(i.job.state));
    pollT = setTimeout(() => L.load().catch(() => schedule()), busy ? 2500 : 15000);
  }

  function filtered() {
    const view = L.VIEWS.find((v) => v[0] === L.view) || L.VIEWS[0];
    const q = L.q.trim().toLowerCase();
    let list = L.items.filter(view[3]);
    if (L.tag) list = list.filter((i) => i.tags.includes(L.tag));
    if (q) list = list.filter((i) => [i.title_zh, i.title_en, i.authors, i.venue, i.arxiv, i.abstract, (i.tags || []).join(" "), i.year]
      .join(" ").toLowerCase().includes(q));
    const key = { opened: (i) => i.last_opened || i.added, added: (i) => i.added, year: (i) => String(i.year || ""), title: (i) => i.title_zh || i.title_en };
    const k = key[L.sort] || key.opened;
    list.sort((a, b) => (L.sort === "title" ? String(k(a)).localeCompare(String(k(b)), "zh") : String(k(b)).localeCompare(String(k(a)))));
    return list;
  }

  function statusPill(i) {
    const m = { unread: "未讀", reading: "在讀", done: "已讀" };
    return '<span class="pill ' + (i.status || "unread") + '">' + (m[i.status] || "未讀") + "</span>";
  }
  L.jobLine = function (i) {
    const j = i.job;
    if (j && ["queued", "running"].includes(j.state)) {
      const pct = j.total ? " " + j.done + "/" + j.total + " 頁" : "";
      return '<span class="stat job"><span class="spin"></span>' + PR.esc(j.state === "queued" ? "排隊中" : (j.message || "處理中")) + pct + "</span>";
    }
    if (j && j.state === "error") return '<span class="stat err">翻譯出錯</span>';
    if (j && j.state === "partial") return '<span class="stat err">' + Object.keys(j.failed || {}).length + " 頁沒譯成功</span>";
    const tr = i.done_pages - (i.en_pages || 0);
    if (i.en_pages && !tr) return '<span class="stat">英文原文</span>';
    if (i.pages && tr < i.pages) return '<span class="stat">已譯 ' + tr + "/" + i.pages + " 頁</span>";
    return "";
  };

  function rowHtml(i) {
    const title = i.title_zh || i.title_en || "（未命名）";
    const sub = i.title_zh && i.title_en ? '<div class="t2" lang="en">' + PR.esc(i.title_en) + "</div>" : "";
    const bits = [i.authors && PR.esc(i.authors.split(",").slice(0, 3).join(",") + (i.authors.split(",").length > 3 ? " 等" : "")), i.year, i.venue || i.arxiv].filter(Boolean);
    const tags = (i.tags || []).map((t) => '<span class="chip cat">' + PR.icon("folder", "sm") + PR.esc(t) + "</span>").join("");
    const thumb = i.thumb ? '<div class="thumb" style="background-image:url(' + i.thumb + ')"></div>' : '<div class="thumb blank">' + PR.icon("pdf") + "</div>";
    const notes = i.notes + i.highlights ? '<span class="stat">' + PR.icon("note", "sm") + (i.notes + i.highlights) + (i.open_questions ? " · " + i.open_questions + " 問待答" : "") + "</span>" : "";
    const prog = i.progress ? '<div class="meter" title="閱讀進度 ' + Math.round(i.progress * 100) + '%"><i style="width:' + Math.round(i.progress * 100) + '%"></i></div>' : "";
    return '<div class="row' + (L.selected === i.id ? " on" : "") + '" data-id="' + i.id + '" role="option" draggable="true">' + thumb +
      '<div><div class="t1">' + (i.starred ? '<span class="star">' + PR.icon("star") + "</span>" : "") + "<span>" + PR.esc(title) + "</span></div>" + sub +
      '<div class="t3">' + bits.map((b) => "<span>" + PR.esc(String(b)) + "</span>").join("<span>·</span>") + tags + "</div></div>" +
      '<div class="side-info">' + statusPill(i) + prog + L.jobLine(i) + notes + "</div></div>";
  }

  L.render = function () {
    PR.renderSide();
    const list = filtered();
    const view = L.VIEWS.find((v) => v[0] === L.view) || L.VIEWS[0];
    PR.$("#viewTitle").textContent = L.tag ? L.tag : view[1] + (L.view === "all" ? "論文" : "");
    PR.$("#count").textContent = list.length + " 篇";
    PR.$("#list").innerHTML = list.length ? list.map(rowHtml).join("") : emptyHtml();
    if (L.selected && !L.byId(L.selected)) L.select(null);
    else PR.renderDetail && PR.renderDetail();
  };
  function emptyHtml() {
    if (L.items.length) return '<div class="empty-state"><div class="big">沒有符合條件的論文</div>換個關鍵詞或篩選試試。</div>';
    const ok = L.engineReady;
    return '<div class="welcome">' + PR.logo("hero") + "<h2>把英文論文，讀成舒服的繁體中文</h2>" +
      '<p class="sub">匯入 PDF，背景逐頁翻譯；公式、表格照原文排好，隨時對照原文，邊讀邊劃線、記筆記、提問。</p>' +
      '<ol class="steps">' +
      '<li class="' + (ok ? "done" : "") + '"><b>選一個翻譯引擎</b><span>' + (ok === undefined ? '<span class="spin"></span> 正在檢測本機…' : ok ? "已就緒：" + PR.esc(L.engineLabel) : "當前引擎還不能用，" + (L.engineHint || "去設定裡選一個")) + '</span><button class="btn sm ' + (ok ? "line" : "accent") + '" onclick="PR.openSettings()">' + (ok ? "換一個" : "去設定") + "</button></li>" +
      "<li><b>匯入論文</b><span>拖進 PDF、貼上 arXiv 連結，或者直接在這個頁面按 Ctrl+V</span>" +
      '<button class="btn sm accent" onclick="PR.openImport()">' + PR.icon("plus", "sm") + "匯入</button></li>" +
      '<li><b>開始讀</b><span>點段落出操作條，選中文字能劃線、寫筆記、提問；按 <kbd>?</kbd> 看快捷鍵</span></li></ol>' +
      '<p class="try">沒有現成的論文？試試 <button class="linkish" onclick="PR.importRef(&quot;1706.03762&quot;)">Attention Is All You Need</button></p></div>';
  }

  /* 頂欄上的引擎狀態：一眼看出現在用什麼翻譯、能不能用 */
  async function engineChip() {
    const chip = PR.$("#engineChip");
    chip.innerHTML = '<span class="dot"></span><span>' + PR.esc(L.engineLabel || "") + "</span>";
    if (L.engineReady === undefined && !engineChip.pending) {
      engineChip.pending = true;
      const r = await PR.api("/api/engines").catch(() => null);
      engineChip.pending = false;
      L.engineReady = r ? r.ready : true;
      const f = r && r.found && r.found[L.engine];
      L.engineHint = f && !f.found ? "本機沒找到 " + L.engineLabel : L.engine === "openai" ? "API 還沒填 Key" : "";
      L.render();
    }
    chip.classList.toggle("bad", L.engineReady === false);
    chip.title = L.engineReady === false ? "翻譯引擎還不能用：" + (L.engineHint || "") + "（點這裡設定）" : "翻譯引擎（點這裡設定）";
  }
  PR.$("#engineChip").onclick = () => PR.openSettings();

  L.select = function (id) {
    L.selected = id;
    PR.$(".lib").classList.toggle("has-detail", !!id);
    PR.$$(".row").forEach((r) => r.classList.toggle("on", r.dataset.id === id));
    PR.renderDetail && PR.renderDetail();
  };

  /* ---------- 事件 ---------- */
  PR.$("#list").addEventListener("click", (e) => {
    const r = e.target.closest(".row");
    if (r) L.select(r.dataset.id);
  });
  /* 點列表空白處、側欄、標題欄空白：收起右側詳情 */
  document.addEventListener("click", (e) => {
    if (!L.selected || e.target.closest(".row, #detail, .dialog-backdrop, .menu, #toast, .topbar button, .topbar input, select")) return;
    if (e.target.closest(".main, .side, .topbar")) L.select(null);
  });
  PR.$("#list").addEventListener("dblclick", (e) => { const r = e.target.closest(".row"); if (r) L.openReader(r.dataset.id); });
  PR.$("#list").addEventListener("contextmenu", (e) => {
    const r = e.target.closest(".row");
    if (!r) return;
    e.preventDefault();
    L.select(r.dataset.id);
    PR.rowMenu && PR.rowMenu(r.dataset.id, { x: e.clientX, y: e.clientY });
  });
  PR.$("#q").addEventListener("input", PR.debounce((e) => { L.q = e.target.value; L.render(); }, 120));
  PR.$("#sort").addEventListener("change", (e) => { L.sort = e.target.value; PR.ls.set("easyread-sort", L.sort); L.render(); });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (PR.$(".dialog-backdrop.open")) return;
    const rows = PR.$$(".row");
    const idx = rows.findIndex((r) => r.dataset.id === L.selected);
    if (e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); PR.$("#q").focus(); }
    else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const r = rows[Math.min(rows.length - 1, idx + 1)]; if (r) { L.select(r.dataset.id); r.scrollIntoView({ block: "nearest" }); } }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); const r = rows[Math.max(0, idx - 1)]; if (r) { L.select(r.dataset.id); r.scrollIntoView({ block: "nearest" }); } }
    else if (e.key === "Enter" && L.selected) L.openReader(L.selected);
    else if (e.key === "Escape") L.select(null);
    else if (e.key === "s" && L.selected) { const it = L.byId(L.selected); L.patch(it.id, { starred: !it.starred }); }
  });

  PR.onSettingsSaved = () => L.load();
  // 從閱讀頁按“返回”回來時瀏覽器可能直接用快取的舊頁面：重新取一次，在讀狀態、進度馬上更新
  window.addEventListener("pageshow", (e) => { if (e.persisted) L.load().catch(() => {}); });
  // 等側欄、詳情這些指令碼都載入完再取資料：資料先到、指令碼還沒到時會出錯
  document.addEventListener("DOMContentLoaded", () => {
    PR.loadPrefs().then((p) => { if (p.reader && p.reader.theme) PR.applyTheme(p.reader.theme); PR.useServerUi(p); L.useServerSide(p); });
    L.load().catch((e) => { PR.$("#list").innerHTML = '<div class="empty-state"><div class="big">連不上本地服務</div>' + PR.esc(e.message) + "</div>"; });
  });
})(window.PR);
