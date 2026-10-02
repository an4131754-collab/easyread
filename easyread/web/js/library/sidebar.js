/* 文獻庫左側欄，學 Claude / ChatGPT 的側欄：
   - 置頂：單篇論文和分類都能置頂，放最上面。
   - 分類：“全部”固定；在讀 / 未讀 / 已讀 / 星標是內建分類，可以隱藏；自己建的分類可以改名、刪除。
     點“＋”新建；右鍵或“⋯”開啟選單；把論文拖到分類上就放進去（拖到在讀 / 未讀 / 已讀是改狀態，拖到星標是加星標）。一篇論文可以在好幾個分類裡（存在論文的 tags 裡）。
   - 最近閱讀：預設 5 篇，展開最多 10 篇；顯示短標題。置頂了的論文、分類只出現在“置頂”裡，不在下面重複。
   - 側欄右邊緣可以拖動調寬度。
   側欄的設定（自建分類的順序、隱藏、置頂）存在 prefs.json 的 library 裡。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const BUILTIN = [
    ["all", "全部", "book", () => true],
    ["reading", "在讀", "book", (i) => i.status === "reading"],
    ["unread", "未讀", "book", (i) => (i.status || "unread") === "unread"],
    ["done", "已讀", "check", (i) => i.status === "done"],
    ["starred", "星標", "star", (i) => i.starred],
  ];
  const AUTO = [  // 有內容時才出現，不用管理
    ["questions", "有待回答的問題", "question", (i) => i.open_questions > 0],
    ["translating", "翻譯中", "sparkle", (i) => i.job && ["queued", "running"].includes(i.job.state)],
  ];
  L.VIEWS = BUILTIN.concat(AUTO);
  const RECENT_SHORT = 5, RECENT_MAX = 10;
  const ui = { adding: false, renaming: null, recentOpen: false };

  /* ---------- 側欄設定 ---------- */
  L.side = Object.assign({ cats: [], hidden: [], pinned: [] }, PR.ls.get("easyread-lib-side", {}));
  function saveSide() {
    PR.ls.set("easyread-lib-side", L.side);
    PR.savePrefs("library", { cats: L.side.cats, hidden: L.side.hidden, pinned: L.side.pinned });
  }
  L.useServerSide = (p) => { if (p && p.library) { Object.assign(L.side, p.library); PR.ls.set("easyread-lib-side", L.side); L.render(); } };

  /* 全部自建分類：設定裡記下的順序 + 論文上已有但沒記下的（舊版的標籤） */
  L.cats = function () {
    const out = L.side.cats.slice();
    L.items.forEach((i) => (i.tags || []).forEach((t) => { if (!out.includes(t)) out.push(t); }));
    return out;
  };
  const isPinned = (key) => L.side.pinned.includes(key);
  L.togglePin = (key) => {
    L.side.pinned = isPinned(key) ? L.side.pinned.filter((k) => k !== key) : [key].concat(L.side.pinned);
    saveSide(); L.render();
  };

  async function patchMany(changes) {  // [[id, {tags}]]：先改介面，再逐個存
    changes.forEach(([id, f]) => Object.assign(L.byId(id) || {}, f));
    L.render();
    for (const [id, f] of changes) await PR.api("/api/p/" + id + "/item", { method: "POST", body: f }).catch((e) => PR.toast("儲存失敗：" + PR.esc(e.message)));
    L.load();
  }
  L.addCat = function (name, paperId) {
    name = (name || "").trim().slice(0, 30);
    if (!name) return L.render();
    if (!L.cats().includes(name)) { L.side.cats.push(name); saveSide(); }
    if (paperId) { const it = L.byId(paperId); if (it && !(it.tags || []).includes(name)) return patchMany([[paperId, { tags: (it.tags || []).concat(name) }]]); }
    L.render();
  };
  L.renameCat = function (from, to) {
    to = (to || "").trim().slice(0, 30);
    if (!to || to === from) return L.render();
    if (L.cats().includes(to)) { PR.toast("已經有叫“" + PR.esc(to) + "”的分類"); return L.render(); }
    L.side.cats = L.cats().map((c) => (c === from ? to : c));
    L.side.pinned = L.side.pinned.map((k) => (k === "c:" + from ? "c:" + to : k));
    L.side.hidden = L.side.hidden.map((k) => (k === "c:" + from ? "c:" + to : k));
    if (L.tag === from) L.tag = to;
    saveSide();
    patchMany(L.items.filter((i) => (i.tags || []).includes(from)).map((i) => [i.id, { tags: i.tags.map((t) => (t === from ? to : t)) }]));
  };
  L.deleteCat = async function (name, at) {
    const n = L.items.filter((i) => (i.tags || []).includes(name)).length;
    if (!(await PR.confirm({ title: "刪除分類“" + name + "”？", body: n ? "裡面的 " + n + " 篇論文不會刪，只是不再屬於這個分類。" : "", ok: "刪除", danger: true, at }))) return;
    L.side.cats = L.cats().filter((c) => c !== name);
    L.side.pinned = L.side.pinned.filter((k) => k !== "c:" + name);
    L.side.hidden = L.side.hidden.filter((k) => k !== "c:" + name);
    if (L.tag === name) L.tag = null;
    saveSide();
    patchMany(L.items.filter((i) => (i.tags || []).includes(name)).map((i) => [i.id, { tags: i.tags.filter((t) => t !== name) }]));
  };
  L.toggleInCat = function (id, name) {
    const it = L.byId(id);
    if (!it) return;
    const has = (it.tags || []).includes(name);
    patchMany([[id, { tags: has ? it.tags.filter((t) => t !== name) : (it.tags || []).concat(name) }]]);
  };
  L.setHidden = function (view, hide) {
    L.side.hidden = hide ? Array.from(new Set(L.side.hidden.concat(view))) : L.side.hidden.filter((v) => v !== view);
    if (hide && L.view === view) L.view = "all";
    saveSide(); L.render();
  };
  L.moveCat = function (name, d) {
    const list = L.cats(), i = list.indexOf(name), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    L.side.cats = list; saveSide(); L.render();
  };

  /* ---------- 畫面 ---------- */
  const count = (fn) => L.items.filter(fn).length;
  const more = '<span class="more" data-more title="更多">' + PR.icon("more", "sm") + "</span>";
  function viewRow(v, pinnedRow) {
    const [k, label, icon, fn] = v;
    return '<div class="srow' + (L.view === k && !L.tag ? " on" : "") + '" data-view="' + k + '"' + (pinnedRow ? " data-pinrow" : "") + ">" + PR.icon(icon, "sm") + "<span class=\"t\">" + label +
      '</span><span class="n">' + count(fn) + "</span>" + (k === "all" && !pinnedRow ? "" : more) + "</div>";
  }
  function catRow(c, pinnedRow) {
    if (ui.renaming === c && !pinnedRow) return '<div class="srow editing">' + PR.icon("folder", "sm") + '<input class="side-input" data-rename="' + PR.esc(c) + '" value="' + PR.esc(c) + '" maxlength="30"></div>';
    return '<div class="srow' + (L.tag === c ? " on" : "") + '" data-cat="' + PR.esc(c) + '"' + (pinnedRow ? " data-pinrow" : "") + ">" + PR.icon("folder", "sm") +
      '<span class="t">' + PR.esc(c) + '</span><span class="n">' + count((i) => (i.tags || []).includes(c)) + "</span>" + more + "</div>";
  }
  /* 側欄放短標題：優先用翻譯時起的短標題，其次取中文標題冒號前那半句 */
  const shortTitle = (i) => i.short_zh || (i.title_zh || "").split(/[：:]/)[0] || i.title_en || "（未命名）";
  function paperRow(i, pinnedRow) {
    const title = i.title_zh || i.title_en || "（未命名）";
    return '<a class="srow paper" href="/read/' + i.id + '" data-paper="' + i.id + '"' + (pinnedRow ? " data-pinrow" : "") + ' title="' + PR.esc(title) + (i.last_opened ? "（" + PR.esc(PR.relTime(i.last_opened)) + "開啟）" : "") + '">' +
      (pinnedRow ? PR.icon("pin", "sm") : "") + '<span class="t">' + PR.esc(shortTitle(i)) + "</span>" + (i.progress > 0.02 ? "<em>" + Math.round(i.progress * 100) + "%</em>" : "") + more + "</a>";
  }

  PR.renderSide = function () {
    const box = PR.$("#side");
    if (box.contains(document.activeElement) && document.activeElement.matches(".side-input")) return;  // 正在輸入分類名
    const cats = L.cats();
    const pinned = L.side.pinned.map((key) => {
      const [t, v] = [key.slice(0, 1), key.slice(2)];
      if (t === "p") { const it = L.byId(v); return it ? paperRow(it, true) : ""; }
      if (t === "c") return cats.includes(v) ? catRow(v, true) : "";
      const view = L.VIEWS.find((x) => x[0] === v);
      return view ? viewRow(view, true) : "";
    }).join("");
    let h = pinned ? '<h3>置頂</h3><div class="sgroup">' + pinned + "</div>" : "";
    h += '<h3>分類<button class="h-add" data-add title="新建分類">' + PR.icon("plus", "sm") + "</button></h3><div class=\"sgroup\" data-drop-zone>" +
      BUILTIN.filter(([k]) => k === "all" || (!L.side.hidden.includes(k) && !isPinned("v:" + k))).map((v) => viewRow(v)).join("") +
      AUTO.filter(([k, , , fn]) => count(fn) && !L.side.hidden.includes(k)).map((v) => viewRow(v)).join("") +
      cats.filter((c) => !isPinned("c:" + c) && !L.side.hidden.includes("c:" + c)).map((c) => catRow(c)).join("") +
      (ui.adding ? '<div class="srow editing">' + PR.icon("folder", "sm") + '<input class="side-input" data-new placeholder="分類名，回車" maxlength="30"></div>' : "") +
      (!ui.adding ? '<button class="srow hint-row" data-add>' + PR.icon("plus", "sm") + '<span class="t">' + (cats.length ? "新建分類" : "新建分類，把論文拖進來") + "</span></button>" : "") + "</div>";
    const recent = L.items.filter((i) => i.last_opened && !isPinned("p:" + i.id)).sort((a, b) => String(b.last_opened).localeCompare(String(a.last_opened)));
    if (recent.length) {
      const shown = recent.slice(0, ui.recentOpen ? RECENT_MAX : RECENT_SHORT);
      h += '<h3>最近閱讀</h3><div class="sgroup">' + shown.map((i) => paperRow(i)).join("") +
        (recent.length > RECENT_SHORT ? '<button class="srow toggle-more" data-recent>' + (ui.recentOpen ? "收起" : "展開更多（" + (Math.min(recent.length, RECENT_MAX) - RECENT_SHORT) + "）") + "</button>" : "") + "</div>";
    }
    if (L.trashCount) h += '<div class="sgroup side-trash"><button class="srow" data-trash>' + PR.icon("trash", "sm") + '<span class="t">回收站</span><span class="n">' + L.trashCount + "</span></button></div>";
    box.innerHTML = h;
    const inp = PR.$(".side-input", box);
    if (inp) { inp.focus(); inp.select(); }
  };

  /* ---------- 選單 ---------- */
  function rowMenu(row, where) {
    if (row.dataset.view) {
      const k = row.dataset.view, key = "v:" + k;
      const items = [{ label: isPinned(key) ? "取消置頂" : "置頂", icon: "pin", fn: () => L.togglePin(key) }];
      if (k !== "all") items.push({ label: "在側欄隱藏", icon: "x", fn: () => { L.setHidden(k, true); PR.toast("已隱藏“" + row.textContent.trim().replace(/\d+$/, "") + "”，可以在 設定 → 側邊欄 裡再開啟"); } });
      return PR.menu(where, items);
    }
    if (row.dataset.cat) {
      const c = row.dataset.cat, key = "c:" + c, i = L.cats().indexOf(c);
      return PR.menu(where, [
        { label: isPinned(key) ? "取消置頂" : "置頂", icon: "pin", fn: () => L.togglePin(key) },
        { label: "改名", icon: "edit", fn: () => { ui.renaming = c; L.render(); } },
        { label: "上移", disabled: i <= 0, fn: () => L.moveCat(c, -1) },
        { label: "下移", disabled: i >= L.cats().length - 1, fn: () => L.moveCat(c, 1) },
        { label: "在側欄隱藏", icon: "x", fn: () => { L.setHidden("c:" + c, true); PR.toast("已隱藏“" + PR.esc(c) + "”，可以在 設定 → 側邊欄 裡再開啟"); } },
        "-",
        { label: "刪除分類", icon: "trash", fn: () => L.deleteCat(c) },
      ]);
    }
    if (row.dataset.paper) {
      const id = row.dataset.paper, key = "p:" + id;
      return PR.menu(where, [
        { label: "開啟閱讀", icon: "book", fn: () => L.openReader(id) },
        { label: isPinned(key) ? "取消置頂" : "置頂", icon: "pin", fn: () => L.togglePin(key) },
        { label: "檢視詳情", icon: "note", fn: () => L.select(id) },
      ]);
    }
  }
  /* 論文行（列表裡、詳情裡）用的“放進分類”選單項 */
  L.catMenuItems = function (id) {
    const it = L.byId(id);
    return L.cats().map((c) => ({ label: ((it.tags || []).includes(c) ? "✓ " : "　 ") + c, icon: "folder", fn: () => L.toggleInCat(id, c) }))
      .concat({ label: "新建分類並放進去…", icon: "plus", fn: () => { ui.adding = id; L.render(); } });
  };

  /* ---------- 事件 ---------- */
  const side = PR.$("#side");
  side.addEventListener("click", (e) => {
    if (e.target.closest(".side-input")) return;
    const m = e.target.closest("[data-more]");
    const row = e.target.closest(".srow");
    if (m && row) { e.preventDefault(); e.stopPropagation(); return rowMenu(row, m); }
    if (e.target.closest("[data-add]")) { ui.adding = true; return L.render(); }
    if (e.target.closest("[data-recent]")) { ui.recentOpen = !ui.recentOpen; return L.render(); }
    if (!row) return;
    if (row.dataset.view) { L.view = row.dataset.view; L.tag = null; L.render(); }
    else if (row.dataset.cat) { L.tag = L.tag === row.dataset.cat ? null : row.dataset.cat; L.view = "all"; L.render(); }
    // 論文行是連結，直接開啟
  });
  side.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".srow[data-view], .srow[data-cat], .srow[data-paper]");
    if (!row) return;
    e.preventDefault();
    rowMenu(row, { x: e.clientX, y: e.clientY });
  });
  function commitInput(inp, cancel) {
    if (inp.dataset.done) return;
    inp.dataset.done = "1";
    inp.blur();  // 輸入框還有焦點時側欄不重畫（見 renderSide），先讓它失焦，回車後新分類才會馬上出現
    const val = inp.value;
    const forPaper = typeof ui.adding === "string" ? ui.adding : null;
    if (inp.dataset.new !== undefined) { ui.adding = false; if (!cancel) L.addCat(val, forPaper); else L.render(); }
    else { const from = inp.dataset.rename; ui.renaming = null; if (!cancel) L.renameCat(from, val); else L.render(); }
  }
  side.addEventListener("keydown", (e) => {
    const inp = e.target.closest(".side-input");
    if (!inp) return;
    if (e.key === "Enter") { e.preventDefault(); commitInput(inp); }
    if (e.key === "Escape") { e.preventDefault(); commitInput(inp, true); }
    e.stopPropagation();
  });
  side.addEventListener("focusout", (e) => { const inp = e.target.closest(".side-input"); if (inp && inp.isConnected) setTimeout(() => inp.isConnected && commitInput(inp), 0); });

  /* 側欄寬度：右邊緣拖動，記在本機 */
  const lib = PR.$(".lib");
  const setW = (w) => lib.style.setProperty("--side-w", Math.max(180, Math.min(420, w)) + "px");
  setW(PR.ls.get("easyread-side-w", 248));
  const grip = PR.el("div", { class: "side-grip", title: "拖動調整側欄寬度（雙擊恢復）" });
  lib.appendChild(grip);
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.classList.add("resizing");
    const move = (ev) => setW(ev.clientX);
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.classList.remove("resizing"); PR.ls.set("easyread-side-w", parseInt(lib.style.getPropertyValue("--side-w"), 10)); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
  grip.addEventListener("dblclick", () => { setW(248); PR.ls.set("easyread-side-w", 248); });

  /* 把論文從列表拖到側欄的分類上 */
  let dragId = null;
  document.addEventListener("dragstart", (e) => { const r = e.target.closest && e.target.closest(".row[data-id]"); if (r) { dragId = r.dataset.id; e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "copy"; side.classList.add("dragging"); } });
  document.addEventListener("dragend", () => { dragId = null; side.classList.remove("dragging"); PR.$$(".srow.drop", side).forEach((x) => x.classList.remove("drop")); });
  /* 能放的地方：自建分類、在讀 / 未讀 / 已讀（改狀態）、星標、“新建分類” */
  const STATUS = { reading: "在讀", unread: "未讀", done: "已讀" };
  const dropTarget = (e) => dragId && e.target.closest(".srow[data-cat], .srow[data-view='starred'], .srow[data-view='reading'], .srow[data-view='unread'], .srow[data-view='done'], .srow[data-add]");
  side.addEventListener("dragover", (e) => {
    const row = dropTarget(e);
    PR.$$(".srow.drop", side).forEach((x) => x !== row && x.classList.remove("drop"));
    if (!row) return;
    e.preventDefault(); row.classList.add("drop");
  });
  side.addEventListener("drop", (e) => {
    const row = dropTarget(e);
    if (!row) return;
    e.preventDefault();
    if (row.dataset.add !== undefined) { ui.adding = dragId; side.classList.remove("dragging"); return L.render(); }  // 拖到“新建分類”：建一個，把這篇放進去
    side.classList.remove("dragging"); row.classList.remove("drop");
    const it = L.byId(dragId);
    const v = row.dataset.view;
    if (v === "starred") { if (!it.starred) L.patch(it.id, { starred: true }); PR.toast("已加星標"); }
    else if (STATUS[v]) { if (it.status !== v) L.patch(it.id, { status: v }); PR.toast("已標為" + STATUS[v]); }
    else if (!(it.tags || []).includes(row.dataset.cat)) { L.toggleInCat(it.id, row.dataset.cat); PR.toast("已放進“" + PR.esc(row.dataset.cat) + "”"); }
    else PR.toast("已經在“" + PR.esc(row.dataset.cat) + "”裡了");
  });
})(window.PR);
