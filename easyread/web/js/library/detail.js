/* 文獻庫右側詳情：後設資料編輯、分類、狀態、翻譯任務、引用、刪除。 */
(function (PR) {
  "use strict";
  const L = PR.lib;

  function citeKey(i) {
    const last = (i.authors || "anon").split(",")[0].trim().split(/\s+/).pop().replace(/[^A-Za-z]/g, "").toLowerCase() || "anon";
    const word = (i.title_en || "paper").split(/\s+/).find((w) => w.length > 3) || "paper";
    return last + (i.year || "") + word.replace(/[^A-Za-z]/g, "").toLowerCase();
  }
  PR.cite = function (i, style) {
    const authors = (i.authors || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (style === "bibtex") {
      const arx = (i.arxiv || "").replace(/^arXiv:/i, "").split(/\s/)[0];
      return "@article{" + citeKey(i) + ",\n  title = {" + i.title_en + "},\n  author = {" + authors.join(" and ") + "},\n  year = {" + (i.year || "") + "}" +
        (arx ? ",\n  eprint = {" + arx + "},\n  archivePrefix = {arXiv}" : "") + (i.doi ? ",\n  doi = {" + i.doi + "}" : "") + (i.url ? ",\n  url = {" + i.url + "}" : "") + "\n}";
    }
    if (style === "apa") {
      const apaNames = authors.slice(0, 20).map((a) => { const p = a.split(/\s+/); return p.length > 1 ? p.pop() + ", " + p.map((x) => x[0] + ".").join(" ") : a; });
      const who = apaNames.length > 1 ? apaNames.slice(0, -1).join(", ") + ", & " + apaNames[apaNames.length - 1] : apaNames[0] || "";
      return who + " (" + (i.year || "n.d.") + "). " + i.title_en + ". " + (i.venue || i.arxiv || "") + (i.url ? ". " + i.url : "");
    }
    // GB/T 7714 簡式
    const names = authors.slice(0, 3).map((a) => { const p = a.split(/\s+/); return p.length > 1 ? p.pop() + " " + p.map((x) => x[0]).join(" ") : a; });
    return names.join(", ") + (authors.length > 3 ? ", et al" : "") + ". " + i.title_en + "[J/OL]. " + (i.venue || i.arxiv || "") + ", " + (i.year || "") + "." + (i.url ? " " + i.url : "");
  };
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); PR.toast("已複製" + what); }
    catch (e) { PR.toast("複製失敗，請手動選中"); }
  }


  function jobHtml(i) {
    const j = i.job || {};
    const running = ["queued", "running"].includes(j.state);
    const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
    let h = '<div class="jobbox">';
    if (running) {
      h += '<div><span class="spin"></span> ' + PR.esc(j.message || "處理中") + (j.total ? "（" + j.done + "/" + j.total + " 頁）" : "") + "</div>" +
        (PR.usageShort(j.usage) ? '<div class="hint">' + PR.esc(PR.usageShort(j.usage)) + "</div>" : "") +
        '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="row2"><button class="btn sm line" data-d="cancel">取消</button>' +
        '<button class="btn sm" data-d="read">邊譯邊讀</button></div>';
    } else {
      const full = i.pages && i.done_pages >= i.pages;
      const en = i.en_pages || 0, read = en > 0 || j.read;  // 只讀原文：整理成英文塊，沒翻譯
      h += read ? "<div>英文原文：" + i.done_pages + " / " + i.pages + " 頁" + (full ? " · 全文" : "") + (i.done_pages - en ? " · 其中 " + (i.done_pages - en) + " 頁已譯" : "") + "</div>"
        : "<div>譯文：" + (i.pages ? i.done_pages + " / " + i.pages + " 頁" : "尚未處理") + (full ? " · 全文" : "") + "</div>";
      const failed = Object.keys(j.failed || {}).map(Number).sort((a, b) => a - b);
      if (j.state === "error") h += '<div class="err">上次' + (j.read ? "整理原文" : "翻譯") + '出錯：' + PR.esc(j.error || j.message) + "</div>";
      h += PR.usageCard(j.usage, j.usage_total);
      if (j.state === "partial" && failed.length) h += '<div class="err">第 ' + PR.esc(pageList(failed)) + " 頁沒" + (j.read ? "整理" : "譯") + "成功：" + PR.esc(j.error || "") + "</div>";
      h += '<div class="row2" style="margin-top:8px">' +
        (j.state === "partial" && failed.length ? '<button class="btn sm accent" data-d="retry-failed">重試這 ' + failed.length + " 頁</button>" : "") +
        (en ? '<button class="btn sm accent" data-d="translate-en">翻譯成繁體中文</button>' : "") +
        (!full && !(j.state === "partial" && failed.length) ? '<button class="btn sm ' + (en ? "line" : "accent") + '" data-d="' + (read ? "read-rest" : "translate") + '">' + (read ? "繼續整理剩下的頁" : i.done_pages ? "繼續翻譯剩下的頁" : "開始翻譯") + "</button>" : "") +
        (!full && j.state === "partial" && failed.length && i.pages - i.done_pages > failed.length ? '<button class="btn sm line" data-d="' + (read ? "read-rest" : "translate") + '">' + (read ? "繼續整理剩下的頁" : "繼續翻譯剩下的頁") + "</button>" : "") +
        (j.state ? '<button class="btn sm" data-d="log">' + PR.icon("log", "sm") + "翻譯記錄</button>" : "") + "</div>" +
        (L.engine === "none" ? '<div class="hint" style="margin-top:6px">當前沒有開啟翻譯引擎，去設定裡選一個。</div>' : "");
    }
    return h + "</div>";
  }

  function pageList(ns) { // [3,4,5,9] → "3–5、9"
    const out = [];
    ns.forEach((n) => { const r = out[out.length - 1]; if (r && n === r[1] + 1) r[1] = n; else out.push([n, n]); });
    return out.map(([a, b]) => (a === b ? a : a + "–" + b)).join("、");
  }

  PR.renderDetail = function () {
    const box = PR.$("#detail");
    const i = L.byId(L.selected);
    if (!i) { box.innerHTML = ""; return; }
    if (box.contains(document.activeElement) && document.activeElement.matches("[contenteditable], input")) return; // 正在編輯，不打斷
    const thumb = i.thumb ? '<div class="thumb" style="background-image:url(' + i.thumb + ')"></div>' : '<div class="thumb blank">' + PR.icon("pdf") + "</div>";
    const readLabel = i.progress > 0.02 ? "繼續閱讀 · " + Math.round(i.progress * 100) + "%" : "開始閱讀";
    const status = [["unread", "未讀"], ["reading", "在讀"], ["done", "已讀"]].map(([k, l]) =>
      '<button data-status="' + k + '" class="' + ((i.status || "unread") === k ? "on" : "") + '">' + l + "</button>").join("");
    // 分類：全部分類都列出來，點一下放進 / 拿出
    const cats = L.cats().map((c) => '<button class="catchip' + ((i.tags || []).includes(c) ? " on" : "") + '" data-cattoggle="' + PR.esc(c) + '">' + PR.icon((i.tags || []).includes(c) ? "check" : "folder", "sm") + PR.esc(c) + "</button>").join("");
    box.innerHTML = '<div class="detail-head"><span>論文詳情</span><button class="detail-close" data-d="close" title="收起（Esc）">' + PR.icon("x", "sm") + "</button></div>" +
      '<div class="detail-inner">' +
      '<div class="cover">' + thumb + '<div class="actions">' +
      '<a class="btn accent" href="/read/' + i.id + '">' + PR.icon("book", "sm") + readLabel + "</a>" +
      '<a class="btn line" href="/p/' + i.id + '/source.pdf" target="_blank" rel="noopener">' + PR.icon("pdf", "sm") + "開啟原 PDF</a>" +
      '<div class="act-row"><button class="btn line" data-d="cite" title="複製參考文獻格式：GB/T 7714、APA、BibTeX">' + PR.icon("copy", "sm") + "複製引用</button>" +
      '<button class="btn icon line" data-d="star" title="星標（S）" style="color:' + (i.starred ? "#c9a24a" : "") + '">' + PR.icon("star", "sm").replace('class="i sm"', 'class="i sm"' + (i.starred ? ' style="fill:currentColor"' : "")) + "</button>" +
      '<button class="btn icon line" data-d="more" title="更多：匯出、開啟資料夾、回收站">' + PR.icon("more", "sm") + "</button></div></div></div>" +
      '<div class="title-zh" contenteditable="plaintext-only" data-meta="title_zh" spellcheck="false">' + PR.esc(i.title_zh || "") + "</div>" +
      '<div class="title-en" contenteditable="plaintext-only" data-meta="title_en" lang="en" spellcheck="false">' + PR.esc(i.title_en || "") + "</div>" +
      '<div class="cats">' + cats + '<button class="catchip add" data-d="newcat">' + PR.icon("plus", "sm") + "新分類</button>" +
      '<input id="catInput" class="catchip" placeholder="分類名，回車確定" maxlength="30" hidden></div>' +
      '<div class="seg">' + status + "</div>" +
      '<div class="kv"><span>作者</span><span contenteditable="plaintext-only" data-meta="authors">' + PR.esc(i.authors) + "</span>" +
      '<span>年份</span><span contenteditable="plaintext-only" data-meta="year">' + PR.esc(i.year) + "</span>" +
      '<span>出處</span><span contenteditable="plaintext-only" data-meta="venue">' + PR.esc(i.venue || i.arxiv) + "</span>" +
      '<span>連結</span><span contenteditable="plaintext-only" data-meta="url">' + PR.esc(i.url) + "</span>" +
      "<span>新增</span><span>" + PR.esc(PR.relTime(i.added)) + (i.last_opened ? "　·　上次開啟 " + PR.esc(PR.relTime(i.last_opened)) : "") + "</span></div>" +
      "<h4>翻譯</h4>" + jobHtml(i) +
      (i.notes + i.highlights + i.open_questions ? '<p class="mine-line">' + [i.notes && i.notes + " 條筆記", i.highlights && i.highlights + " 處劃線", i.open_questions && i.open_questions + " 個問題待回答"].filter(Boolean).join(" · ") + "</p>" : "") +
      (i.abstract ? '<h4>摘要</h4><div class="abstract" id="abs">' + PR.esc(i.abstract.replace(/\$([^$]+)\$/g, "$1")) + '</div><button class="linkish" data-d="abs">展開全文</button>' : "") +
      "</div>";
  };

  async function saveMeta(el) {
    const i = L.byId(L.selected);
    const key = el.dataset.meta, val = el.textContent.trim();
    if ((i[key] || "") === val) return;
    const override = Object.assign({}, { [key]: val });
    await L.patch(i.id, { meta_override: Object.assign({}, i.meta_override || {}, override) });
  }

  const box = PR.$("#detail");
  box.addEventListener("focusout", (e) => { if (e.target.matches("[data-meta]")) saveMeta(e.target); });
  box.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-meta]") && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    if (e.target.id === "catInput" && e.key === "Enter" && e.target.value.trim()) { L.addCat(e.target.value, L.selected); e.target.value = ""; }
    if (e.target.id === "catInput" && e.key === "Escape") { e.stopPropagation(); e.target.value = ""; e.target.blur(); }
  });
  /* 新分類：平時是個按鈕，點了才變成輸入框；沒輸入就離開，變回按鈕 */
  box.addEventListener("focusout", (e) => {
    if (e.target.id !== "catInput" || e.target.value.trim()) return;
    e.target.hidden = true;
    const btn = box.querySelector('[data-d="newcat"]');
    if (btn) btn.hidden = false;
  });
  box.addEventListener("click", async (e) => {
    const i = L.byId(L.selected);
    if (!i) return;
    const st = e.target.closest("[data-status]");
    if (st) return L.patch(i.id, { status: st.dataset.status });
    const ct = e.target.closest("[data-cattoggle]");
    if (ct) return L.toggleInCat(i.id, ct.dataset.cattoggle);
    const d = e.target.closest("[data-d]");
    if (!d) return;
    const act = d.dataset.d;
    if (act === "newcat") { d.hidden = true; const inp = PR.$("#catInput"); inp.hidden = false; inp.focus(); return; }
    if (act === "close") L.select(null);
    else if (act === "star") L.patch(i.id, { starred: !i.starred });
    else if (act === "read") L.openReader(i.id);
    else if (act === "abs") { PR.$("#abs").classList.toggle("open"); d.textContent = PR.$("#abs").classList.contains("open") ? "收起" : "展開全文"; }
    else if (act === "cite") PR.menu(d, [
      { label: "GB/T 7714 · 中文論文、學位論文", icon: "copy", fn: () => copy(PR.cite(i, "gb"), " GB/T 7714 引用") },
      { label: "APA · 英文論文常用", icon: "copy", fn: () => copy(PR.cite(i, "apa"), " APA 引用") },
      { label: "BibTeX · LaTeX / Overleaf、Zotero 匯入", icon: "copy", fn: () => copy(PR.cite(i, "bibtex"), " BibTeX") },
      "-",
      { label: "標題 + 連結 · 發給別人", icon: "link", fn: () => copy((i.title_zh ? i.title_zh + "（" + i.title_en + "）" : i.title_en) + "\n" + (i.url || ""), "標題和連結") },
    ]);
    else if (act === "more") PR.rowMenu(i.id, d);
    else if (act === "cancel") { await PR.api("/api/p/" + i.id + "/cancel", { method: "POST", body: {} }); L.load(); }
    else if (act === "retry-failed") { await PR.api("/api/p/" + i.id + "/translate", { method: "POST", body: { failed: true } }); PR.toast("正在重試"); L.load(); }
    else if (act === "log") { const r = await PR.api("/api/p/" + i.id + "/log"); PR.showText("翻譯記錄", r.text); }
    else if (act === "translate") { await PR.api("/api/p/" + i.id + "/translate", { method: "POST", body: {} }); PR.toast("已開始翻譯"); L.load(); }
    else if (act === "translate-en") { await PR.api("/api/p/" + i.id + "/translate", { method: "POST", body: { en: true } }); PR.toast("已開始翻譯，筆記和劃線都保留"); L.load(); }
    else if (act === "read-rest") { await PR.api("/api/p/" + i.id + "/translate", { method: "POST", body: { read: true } }); PR.toast("已開始整理原文"); L.load(); }
  });
  async function retranslateAll(i) {
    if (!(await PR.confirm({ title: "全部重新翻譯？", body: "會消耗模型額度。你改過的譯文、筆記都保留。", ok: "重新翻譯" }))) return;
    await PR.api("/api/p/" + i.id + "/translate", { method: "POST", body: { pages: "1-" + i.pages } });
    PR.toast("已開始重新翻譯"); L.load();
  }

  PR.rowMenu = function (id, where) {
    const i = L.byId(id);
    const setStatus = (s) => () => L.patch(id, { status: s });
    PR.menu(where, [
      { label: "開啟閱讀", icon: "book", kbd: "Enter", fn: () => L.openReader(id) },
      { label: "開啟原 PDF", icon: "pdf", fn: () => window.open("/p/" + id + "/source.pdf") },
      "-",
      { label: i.starred ? "取消星標" : "加星標", icon: "star", kbd: "S", fn: () => L.patch(id, { starred: !i.starred }) },
      { label: L.side.pinned.includes("p:" + id) ? "取消置頂" : "置頂到側欄", icon: "pin", fn: () => L.togglePin("p:" + id) },
      "-",
      ...L.catMenuItems(id),
      { label: "標為未讀", fn: setStatus("unread") }, { label: "標為在讀", fn: setStatus("reading") }, { label: "標為已讀", fn: setStatus("done") },
      "-",
      { label: "複製 BibTeX", icon: "copy", fn: () => copy(PR.cite(i, "bibtex"), " BibTeX") },
      { label: "匯出離線 HTML（可發給別人）", icon: "download", fn: () => { PR.toast("正在打包…"); location.href = "/api/p/" + id + "/export"; } },
      { label: "開啟所在資料夾", icon: "folder", fn: () => PR.api("/api/p/" + id + "/reveal", { method: "POST", body: {} }).catch((e) => PR.toast(PR.esc(e.message))) },
      { label: "全部重新翻譯", icon: "redo", fn: () => retranslateAll(i) },
      { label: "翻譯記錄", icon: "log", fn: async () => { const r = await PR.api("/api/p/" + id + "/log"); PR.showText("翻譯記錄", r.text); } },
      { label: "移到回收站", icon: "trash", fn: async () => {
        if (!(await PR.confirm({ title: "移到回收站？", body: "《" + (i.title_zh || i.title_en) + "》會放進回收站，隨時可以在左側“回收站”裡恢復。", ok: "移到回收站", danger: true }))) return;
        const r = await PR.api("/api/p/" + id + "/delete", { method: "POST", body: {} }).catch((e) => { PR.toast("沒刪成：" + PR.esc(e.message)); return null; });
        if (!r) return;
        L.select(null); await L.load();
        const name = r && r.trash ? r.trash.split(/[\\/]/).pop() : "";
        PR.toast("已移到回收站", name ? { label: "撤銷", fn: () => PR.restoreTrash(name) } : null);
      } },
    ]);
  };
})(window.PR);
