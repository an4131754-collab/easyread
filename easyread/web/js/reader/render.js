/* 把 paper.json 的塊排成正文。譯文優先取“我的修改”，否則取譯者稿。
   只讀原文（不翻譯）整理出來的塊沒有 zh，正文直接排英文；之後翻譯了就地換成中文。 */
(function (PR) {
  "use strict";
  const S = PR.state;

  /* ---------- 譯文取值：key 形如 "s1-p1"、"tab1#caption"、"s1-recs#2" ---------- */
  PR.blockById = {};
  function fields(key) {  // [譯文, 原文]
    const [id, field] = key.split("#");
    const b = PR.blockById[id];
    if (!b) return ["", ""];
    if (field === "caption") return [b.caption_zh || "", b.caption_en || ""];
    if (field != null && /^\d+$/.test(field)) { const it = (b.items || [])[+field] || {}; return [it.zh || "", it.en || ""]; }
    return [b.zh || "", b.en || ""];
  }
  PR.agentText = function (key) { const [zh, en] = fields(key); return zh || en; };
  /* 這處還沒有譯文、正文排的是英文原文（只讀原文） */
  PR.isEnKey = function (key) { const [zh, en] = fields(key); return !zh && !!en && !PR.editOf(key); };
  PR.hasZh = (b) => !!(b.zh || b.caption_zh || (b.items || []).some((i) => i.zh));
  PR.editOf = function (key) { const e = (S.reader.edits || {})[key]; return e && e.zh != null ? e : null; };
  PR.textFor = function (key) { const e = PR.editOf(key); return e ? e.zh : PR.agentText(key); };
  PR.isStale = function (key) { const e = PR.editOf(key); return !!(e && e.base && e.base !== PR.hashText(PR.agentText(key))); };
  PR.blockKeys = function (b) {
    if (b.type === "list") return (b.items || []).map((_, i) => b.id + "#" + i);
    if (b.type === "table" || b.type === "figure") return [b.id + "#caption"];
    if (b.type === "math" || b.type === "references" || b.type === "note") return [];
    return [b.id];
  };

  function buildIndex() {
    PR.blockById = {};
    PR.xindex = { eq: {}, tab: {}, fig: {}, sec: {} };
    PR.headings = [];
    PR.refById = {};
    PR.order = {};
    (S.paper.references || []).forEach((r) => (PR.refById[String(r.id)] = r));
    (S.paper.blocks || []).forEach((b, i) => {
      PR.blockById[b.id] = b;
      PR.order[b.id] = i;
      if (b.type === "math" && b.tag) PR.xindex.eq[b.tag] = b.id;
      if (b.type === "table" && b.num) PR.xindex.tab[b.num] = b.id;
      if (b.type === "figure" && b.num) PR.xindex.fig[b.num] = b.id;
      if (b.type === "heading" || b.type === "references") { if (b.num) PR.xindex.sec[b.num] = b.id; PR.headings.push(b); }
    });
  }

  function staleTag(key) { return PR.isStale(key) ? '<button class="stale-tag" data-t="stale" title="你改過這段之後，譯者稿又更新了">譯者稿有更新</button>' : ""; }
  function zhDiv(key) {
    const en = PR.isEnKey(key) ? ' lang="en"' : "";
    return '<div class="zh' + (en ? " en-main" : "") + '"' + en + ' data-key="' + PR.esc(key) + '">' + PR.md(PR.textFor(key)) + staleTag(key) + "</div>";
  }
  const enIfZh = (key, text) => (PR.isEnKey(key) ? "" : enDiv(text));  // 正文已經是英文了，就不再附一份原文
  function enDiv(text) { return text ? '<div class="en" lang="en">' + PR.md(text) + "</div>" : ""; }

  function captionHtml(b) {
    const key = b.id + "#caption";
    const text = PR.textFor(key);
    const m = text.match(/^([^：:]{1,12})[：:]/);
    const body = m ? '<span class="label">' + PR.esc(m[1]) + "</span>" + PR.md(text.slice(m[1].length)) : PR.md(text);
    const en = PR.isEnKey(key) ? ' lang="en"' : "";
    return '<div class="caption"><div class="zh' + (en ? " en-main" : "") + '"' + en + ' data-key="' + key + '">' + body + staleTag(key) + "</div>" + enIfZh(key, b.caption_en) + "</div>";
  }
  function cell(c) { return PR.md(String(c), { xref: false, cite: false }).replace(/<br>(\([^<]*\))/g, '<br><span class="sub">$1</span>'); }
  function linkify(t) { return PR.esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }

  const R = {
    heading(b) {
      const tag = (b.level || 1) === 1 ? "h2" : "h3";
      const en = PR.isEnKey(b.id);
      return "<" + tag + ' class="zh' + (en ? ' en-main" lang="en"' : '"') + ' data-key="' + b.id + '">' + (b.num ? '<span class="num">' + PR.esc(b.num) + "</span>" : "") +
        "<span>" + PR.md(PR.textFor(b.id)) + "</span>" + staleTag(b.id) +
        (b.en && !en ? '<span class="en-title" lang="en">' + PR.md(b.en, { cite: false, xref: false }) + "</span>" : "") + "</" + tag + ">";
    },
    para: (b) => zhDiv(b.id) + enIfZh(b.id, b.en),
    list(b) {
      const tag = b.ordered ? "ol" : "ul";
      return "<" + tag + ">" + (b.items || []).map((it, i) => "<li>" + zhDiv(b.id + "#" + i) + enIfZh(b.id + "#" + i, it.en) + "</li>").join("") + "</" + tag + ">";
    },
    math: (b) => '<div class="math-row"><div class="math-body">' + PR.tex(b.tex, true) + "</div>" + (b.tag ? '<div class="math-tag">(' + PR.esc(b.tag) + ")</div>" : "") + "</div>",
    table(b) {
      const al = (b.align || "").split("");
      const style = (i) => (al[i] ? ' style="text-align:' + ({ l: "left", r: "right", c: "center" }[al[i]] || "left") + '"' : "");
      const head = (b.head || []).map((r) => "<tr>" + r.map((c, i) => "<th" + style(i) + ">" + cell(c) + "</th>").join("") + "</tr>").join("");
      const rows = (b.rows || []).map((r) => "<tr>" + r.map((c, i) => "<td" + style(i) + ">" + cell(c) + "</td>").join("") + "</tr>").join("");
      const table = '<div class="tbl-wrap"><table class="tbl"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
      return b.caption_pos === "above" ? captionHtml(b) + table : table + captionHtml(b);
    },
    figure(b) {
      const img = b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="" loading="lazy">'
        : '<button class="fig-missing" data-t="page">圖見原文第 ' + b.page + " 頁（點選檢視）</button>";
      return img + captionHtml(b);
    },
    note: (b) => '<div class="inline-note"><div class="lbl">閱讀批註（非原文）</div>' + PR.mdBlocks(b.zh) + "</div>",
    references(b) {
      const refs = (S.paper.references || []).map((r) => '<li id="ref-' + PR.esc(r.id) + '"><span class="n">[' + PR.esc(r.id) + "]</span><span>" + linkify(r.text) + "</span></li>").join("");
      if (!b.zh && b.en) return '<h2 class="zh en-main" lang="en" data-key="' + b.id + '"><span>' + PR.esc(b.en) + '</span></h2><div class="refs"><ol>' + refs + "</ol></div>";
      return '<h2 class="zh" data-key="' + b.id + '"><span>' + PR.esc(b.zh || "參考文獻") + '</span><span class="en-title" lang="en">' + PR.esc(b.en || "References") + "</span></h2>" +
        '<div class="refs"><p class="note">條目保留原文，便於檢索。</p><ol>' + refs + "</ol></div>";
    },
  };

  function blockClass(b) {
    let c = "blk blk-" + b.type;
    if (b.type === "heading") c += " h" + (b.level || 1) + (b.appendix ? " appendix" : "");
    if (b.type === "references") c += " blk-heading h1";
    if (b.cont) c += " cont";
    if (b.role === "abstract") c += " abstract";
    return c;
  }
  const edited = (b) => PR.blockKeys(b).some((k) => PR.editOf(k));

  function sectionHtml(b, extraClass, pageMark) {
    return '<section class="' + blockClass(b) + (extraClass || "") + '" id="b-' + PR.esc(b.id) + '" data-id="' + PR.esc(b.id) + '">' +
      (pageMark ? '<button class="pgmark" data-t="page" title="看原文第 ' + b.page + ' 頁">p.' + b.page + "</button>" : "") +
      R[b.type](b) + (edited(b) ? '<span class="edited-dot" title="這裡有你改過的譯文"></span>' : "") + "</section>";
  }

  /* 線上演示的署名和許可（CC BY 要求寫明出處），網址做成連結 */
  function creditHtml() {
    const c = S.demo && S.demo.credit;
    if (!c) return "";
    const link = (u) => '<a href="' + u + '" target="_blank" rel="noopener">' + u.replace(/^https?:\/\//, "") + "</a>";
    return '<p class="demo-credit">' + PR.esc(c).replace(/https?:\/\/[^\s（）()，。,]+/g, link) + "</p>";
  }

  function headHtml() {
    const m = S.paper.meta || {};
    const tr = S.paper.translation || {};
    const kicker = [m.arxiv, m.venue, m.date].filter(Boolean).map(PR.esc).join("　·　");
    const by = [m.authors, m.affiliation].filter(Boolean).map(PR.esc).join("　·　");
    const pages = (m.pages || []).length, done = (tr.done_pages || []).length, en = (tr.en_pages || []).length;
    const toZh = en && PR.canAsk() && !jobRunning() ? '<button class="btn sm line" data-t="translate-en">翻譯成繁體中文</button>' : "";
    const scope = (en ? "<b>英文原文</b>　" + (done - en ? "其中 " + (done - en) + " 頁已譯，" : "") + en + " 頁沒有翻譯" + toZh
      : "<b>譯文</b>　" + (pages ? (done >= pages ? "全文 " + pages + " 頁" : "已譯 " + done + " / " + pages + " 頁") : "尚未處理")) +
      (tr.note ? "　" + PR.esc(tr.note) : "") +
      "<br>" + (en ? "沒譯的地方正文是英文原文" : "正文是譯文") + '；<span class="legend-agent"></span>青色細線是 AI 的解釋和回答，<span class="legend-mine"></span>赭色細線是我的筆記，都不屬於原文。';
    return '<header class="paper-head" id="b-head" data-id="head">' + (kicker ? '<div class="kicker">' + kicker + "</div>" : "") +
      "<h1>" + PR.esc(m.title_zh || m.title_en || "（正在識別標題）") + "</h1>" +
      (m.title_zh && m.title_en ? '<p class="title-en" lang="en">' + PR.esc(m.title_en) + "</p>" : "") +
      (by ? '<p class="byline">' + by + "</p>" : "") + '<p class="scope">' + scope + "</p>" + creditHtml() + "</header>";
  }

  /* 還沒譯的頁：放原頁圖，邊譯邊讀 */
  const origFig = (p) => '<figure class="orig-page" id="orig-' + p.n + '"><figcaption>原文第 ' + p.n + ' 頁</figcaption><img loading="lazy" src="' + PR.imageUrl(p.img) + '" alt="原文第 ' + p.n + ' 頁"></figure>';
  const failedOf = () => ((S.job || {}).state === "partial" && S.job.failed) || {};
  const jobRunning = () => ["queued", "running"].includes((S.job || {}).state);
  const reading = () => !!((S.job || {}).read || ((S.paper.translation || {}).en_pages || []).length);  // 這篇是隻讀原文

  /* 中間漏掉的頁（多半是譯失敗了）：就地放原頁，給重試 */
  function gapHtml(pages) {
    const failed = failedOf();
    const bad = pages.filter((p) => failed[p.n]);
    const running = ["queued", "running"].includes((S.job || {}).state);
    const label = pages.length > 1 ? "第 " + pages[0].n + "–" + pages[pages.length - 1].n + " 頁" : "第 " + pages[0].n + " 頁";
    const head = bad.length ? label + "沒" + (reading() ? "整理" : "譯") + "成功：" + PR.esc(failed[bad[0].n]) + (PR.canAsk() && !running ? '<button class="btn sm line" data-t="retry-failed">重試</button>' : "")
      : label + (running ? "還在排隊" + (reading() ? "整理" : "翻譯") : reading() ? "還沒整理" : "還沒有譯文") + "，先放原頁。";
    return '<div class="pending-pages gap"><div class="pending' + (bad.length ? " bad" : "") + '">' + head + "</div>" + pages.map(origFig).join("") + "</div>";
  }

  function pendingHtml(lastPage) {
    const m = S.paper.meta || {};
    const done = new Set((S.paper.translation || {}).done_pages || []);
    const miss = (m.pages || []).filter((p) => !done.has(p.n) && p.n > lastPage);
    if (!(m.pages || []).length) return '<div class="pending"><span class="spin"></span> 正在渲染原頁、抽取文字…</div>';
    if (!miss.length) return "";
    const job = S.job || {};
    const running = ["queued", "running"].includes(job.state);
    const nFailed = miss.filter((p) => failedOf()[p.n]).length;
    const head = running ? '<span class="spin"></span> ' + PR.esc(job.message || "翻譯中") + (job.total ? "（" + job.done + "/" + job.total + " 頁）" : "") + '<span class="hint">譯好的頁會自動出現在這裡' + (PR.usageShort(job.usage) ? " · " + PR.esc(PR.usageShort(job.usage)) : "") + "</span>"
      : reading() ? "下面 " + miss.length + " 頁還沒整理，先放原頁。" + (nFailed ? "其中 " + nFailed + " 頁上次沒整理成功。" : "") +
        (PR.canAsk() ? '<button class="btn sm line" data-t="read-rest">整理剩下的頁</button>' : "")
      : "下面 " + miss.length + " 頁還沒有譯文，先放原頁。" + (nFailed ? "其中 " + nFailed + " 頁上次沒譯成功。" : "") +
        (PR.canAsk() ? '<button class="btn sm line" data-t="translate-rest">翻譯剩下的頁</button>' : "");
    return '<div class="pending-pages"><div class="pending">' + head + "</div>" + miss.map(origFig).join("") + "</div>";
  }

  PR.renderPaper = function () {
    buildIndex();
    let html = headHtml(), appendixSeen = false, lastPage = 0;
    const done = new Set((S.paper.translation || {}).done_pages || []);
    const allPages = (S.paper.meta || {}).pages || [];
    for (const b of S.paper.blocks || []) {
      if (!R[b.type]) continue;
      if (b.page && b.page > lastPage + 1) {
        const gap = allPages.filter((p) => p.n > lastPage && p.n < b.page && !done.has(p.n));
        if (gap.length) html += gapHtml(gap);
      }
      let extra = "";
      if (b.appendix && !appendixSeen) { extra = " appendix-start"; appendixSeen = true; }
      const mark = b.page && b.page > lastPage;
      if (b.page) lastPage = Math.max(lastPage, b.page);
      html += sectionHtml(b, extra, mark);
    }
    PR.$("#paper").innerHTML = html + pendingHtml(lastPage);
    // 一段譯文都沒有（只讀原文）：頂欄的“譯文 / 對照”沒意義，藏起來
    document.body.classList.toggle("en-only", (S.paper.blocks || []).length > 0 && !(S.paper.blocks || []).some(PR.hasZh));
    PR.emit("rendered");
  };

  /* 只重排一個塊（編輯儲存後用），不動別的塊 */
  PR.renderBlock = function (id) {
    const b = PR.blockById[id];
    const node = document.getElementById("b-" + id);
    if (!b || !node || !R[b.type]) return;
    const fresh = document.createElement("div");
    fresh.innerHTML = sectionHtml(b, node.classList.contains("appendix-start") ? " appendix-start" : "", !!node.querySelector(":scope > .pgmark"));
    const nn = fresh.firstChild;
    ["show-en", "notes-open", "current"].forEach((c) => node.classList.contains(c) && nn.classList.add(c));
    node.replaceWith(nn);
    PR.emit("block-rendered", id);
  };

  /* 版心放不下的長公式、寬表格：先縮小字號，再不行才橫向滾動。
     公式原本多寬只和字號、字型有關，量一次記下來；開關側欄、改視窗大小隻是版心變了，不用再把幾百個公式復原重量一遍
     （復原再量要整頁重排，長論文一兩百毫秒，點“原頁”“筆記”會明顯頓一下）。 */
  // 記的是 { w, over }：over 為真時 w 是放不下時量到的真實寬度；為假時只知道“寬 w 的版心放得下”，版心變窄得重量
  const natural = new WeakMap();
  let typeface = "";
  PR.fitWide = function (scope, remeasure) {  // remeasure：字型剛載入完這類，量過的也不作數
    const paper = PR.$("#paper");
    const cs = getComputedStyle(paper);
    const tf = cs.fontSize + "|" + cs.fontFamily;
    const fresh = remeasure || tf !== typeface;
    typeface = tf;
    const boxes = PR.$$(".math-body, .tbl-wrap", fresh ? paper : scope || paper).filter((box) => box.firstElementChild);
    const avail = boxes.map((box) => box.clientWidth);
    const todo = boxes.filter((box, i) => {
      const n = !fresh && natural.get(box.firstElementChild);
      return !n || !n.w || (!n.over && avail[i] < n.w - 1);  // w 為 0：上次量時藏著（比如對照模式的英文）
    });
    // 要重量的：先全部復原、再一起量、最後一起改，邊改邊量會讓瀏覽器每個公式都重排一次整頁
    todo.forEach((box) => { box.firstElementChild.style.fontSize = ""; });
    todo.forEach((box) => {
      const need = box.firstElementChild.scrollWidth, w = box.clientWidth;
      natural.set(box.firstElementChild, need > w + 1 ? { w: need, over: true } : { w, over: false });
    });
    const floor = window.innerWidth < 760 ? 0.58 : 0.72;
    boxes.forEach((box, i) => {
      const n = natural.get(box.firstElementChild);
      let size = "";
      if (n.over && n.w > avail[i] + 1) {
        const r = Math.max(floor, avail[i] / n.w) * 0.99;
        size = box.classList.contains("tbl-wrap") ? (0.86 * r).toFixed(3) + "em" : (r * 100).toFixed(1) + "%";
      }
      if (box.firstElementChild.style.fontSize !== size) box.firstElementChild.style.fontSize = size;
    });
  };
  PR.on("rendered", () => PR.fitWide());
  PR.on("block-rendered", (id) => PR.fitWide(document.getElementById("b-" + id)));

  /* 保持閱讀位置不動地整頁重排 */
  PR.rerenderKeepingPlace = function () {
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    PR.renderPaper();
    const after = anchor && document.getElementById("b-" + anchor);
    if (after) window.scrollBy(0, after.getBoundingClientRect().top - before);
  };
})(window.PR);
