/* 右側面板：原文頁（隨閱讀位置翻頁、框出當前段）。和筆記面板共用右側，一次開一個。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;
  let pvPage = 1, pvBlock = null;
  const pages = () => (S.paper.meta || {}).pages || [];
  const boxesOf = (loc) => loc.boxes && loc.boxes.length ? loc.boxes : [loc.box];

  /* 右側面板開關：pages | notes | null */
  /* 面板滑出的同時正文就讓位：重排只要幾十毫秒（fitWide 不再重量公式），不必等面板滑完再跳一下。 */
  PR.side = null;
  PR.openSide = function (name) {
    PR.side = name;
    body.classList.toggle("pv-open", name === "pages");
    body.classList.toggle("np-open", name === "notes");
    body.classList.toggle("ch-open", name === "chat");
    PR.$('[data-act="chat"]').classList.toggle("on", name === "chat");
    PR.$('[data-act="pages"]').classList.toggle("on", name === "pages");
    PR.$('[data-act="notes"]').classList.toggle("on", name === "notes");
    if (name) { const t = PR.$("#toast"); if (t) t.classList.remove("open"); }  // 提示條別擋住面板底部的輸入框
    if (body.classList.contains("side-open") === !!name) return;  // 面板之間切換：正文寬度不變
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    body.classList.toggle("side-open", !!name);
    PR.fitWide(); PR.renderMargin();
    if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);  // 重排後還停在剛才讀的地方
  };

  PR.togglePages = function (force) {
    const open = force != null ? force : PR.side !== "pages";
    PR.openSide(open ? "pages" : null);
    if (open) PR.syncPage(true); else pair(null);
  };
  PR.openPage = function (page, blockId) {
    pvBlock = blockId || null;
    if (PR.side !== "pages") PR.openSide("pages");
    showPage(page, blockId);
  };

  /* 原圖是 2.4 倍渲染（約 1500 畫素寬、幾百 KB），面板用不了那麼大：要一張和麵板一樣寬的，服務端生成一次後快取 */
  function srcOf(n) {
    const p = pages()[n - 1];
    if (!p) return "";
    const base = PR.imageUrl(p.img);
    if (PR.store.mode !== "server") return base;
    const need = (PR.$(".pv-scroll").clientWidth || 480) * (body.classList.contains("pv-zoom") ? 1.65 : 1) * (devicePixelRatio || 1);
    return need <= 1000 ? base + "?w=1000" : need <= 1600 ? base + "?w=1600" : base;  // 1000 寬的服務端已提前生成好
  }
  const preloaded = new Set();
  function preload(n) {
    const s = srcOf(n);
    if (s && !preloaded.has(s)) { preloaded.add(s); const im = new Image(); im.decoding = "async"; im.src = s; }
  }
  PR.preloadPage = () => { const b = PR.blockById[PR.readingBlock()]; if (b && b.page) preload(b.page); };

  function showPage(page, blockId) {
    const list = pages();
    if (!list.length) return;
    pvPage = Math.min(list.length, Math.max(1, page));
    const img = PR.$(".pv-page img");
    img.decoding = "async";
    const src = srcOf(pvPage);
    if (img.getAttribute("src") !== src) { img.setAttribute("src", src); PR.$(".pv-page").classList.add("loading"); img.onload = () => PR.$(".pv-page").classList.remove("loading"); }
    preload(pvPage + 1); preload(pvPage - 1);
    PR.$(".pv-label").textContent = "第 " + pvPage + " / " + list.length + " 頁";
    const pdf = PR.$('[data-pv="pdf"]');
    const url = PR.pdfUrl(pvPage);
    pdf.style.display = url ? "" : "none";
    if (url) pdf.href = url;
    const hl = PR.$(".pv-hl");
    const loc = blockId && S.layout[blockId];
    pair(loc && loc.page === pvPage ? blockId : null);
    if (loc && loc.page === pvPage) {
      const boxes = boxesOf(loc);
      hl.replaceChildren(...boxes.map(([x0, y0, x1, y1]) => {
        const region = document.createElement("div");
        region.className = "pv-region";
        Object.assign(region.style, { left: (x0 * 100 - 0.4) + "%", top: (y0 * 100 - 0.3) + "%", width: ((x1 - x0) * 100 + 0.8) + "%", height: ((y1 - y0) * 100 + 0.6) + "%" });
        return region;
      }));
      hl.classList.add("on");
      const scroller = PR.$(".pv-scroll");
      const doScroll = () => { const h = PR.$(".pv-page").offsetHeight;  // 原頁裡框出的那段也放在面板中間
        const [, y0, , y1] = boxes[0];
        scroller.scrollTo({ top: Math.max(0, ((y0 + y1) / 2) * h + 18 - scroller.clientHeight / 2), behavior: "smooth" }); };
      img.complete ? doScroll() : img.addEventListener("load", doScroll, { once: true });
    } else hl.classList.remove("on");
  }

  /* 譯文裡和原頁框對應的那段也標出來（同一個顏色），一眼看出左右是哪兩段 */
  let paired = null, holdUntil = 0;
  function pair(id) {
    if (paired === id) return;
    const old = paired && document.getElementById("b-" + paired);
    if (old) old.classList.remove("pv-pair");
    paired = id;
    const node = id && document.getElementById("b-" + id);
    if (node) node.classList.add("pv-pair");
  }
  PR.on("block-rendered", (id) => { if (id === paired) { paired = null; pair(id); } });  // 段落重畫後補回標記
  PR.on("rendered", () => { const id = paired; paired = null; pair(id); });
  PR.on("remote", (changed) => { if (PR.side === "pages" && changed.includes("layout")) showPage(pvPage, pvBlock); });

  /* 點原頁上的某一段 → 正文跳到那段譯文（排版特殊、看不出語序時，從原文找回去） */
  function blockAt(x, y) {
    let best = null, area = Infinity;
    for (const id in S.layout) {
      const l = S.layout[id];
      if (l.page !== pvPage || !PR.blockById[id]) continue;
      for (const [x0, y0, x1, y1] of boxesOf(l)) {
        const a = (x1 - x0) * (y1 - y0);
        if (x >= x0 - 0.01 && x <= x1 + 0.01 && y >= y0 - 0.006 && y <= y1 + 0.006 && a < area) { best = id; area = a; }
      }
    }
    return best;
  }
  PR.$(".pv-page").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = blockAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (!id) return;
    pvBlock = id;
    holdUntil = Date.now() + 1500;  // 跳過去的滾動會觸發“跟隨閱讀位置”，別讓它把剛點的段換掉
    showPage(pvPage, id);
    PR.jumpTo("b-" + id);
  });
  PR.$(".pv-page").addEventListener("mousemove", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.classList.toggle("pickable", !!blockAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
  });

  PR.syncPage = function (force) {
    if (PR.side !== "pages") return;
    if (!force && (!PR.$(".pv-follow input").checked || Date.now() < holdUntil)) return;
    const reading = PR.readingBlock();
    // Selection controls an explicit click; scrolling follows the viewport.
    const id = force ? (PR.currentBlock && PR.currentBlock()) || reading : reading;
    const b = PR.blockById[id];
    if (!b) {  // 還在標題區，不在任何一段上：給第 1 頁，別讓面板空著
      if (force || pvBlock) { pvBlock = null; showPage(1); }
      return;
    }
    if (!force && id === pvBlock) return;
    pvBlock = id;
    const loc = S.layout[id];
    showPage(loc ? loc.page : b.page, id);
  };

  PR.$("#pageview").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pv]");
    if (!b) return;
    const act = b.dataset.pv;
    if (act === "close") { PR.togglePages(false); pair(null); }
    if (act === "prev") showPage(pvPage - 1, pvBlock);
    if (act === "next") showPage(pvPage + 1, pvBlock);
    if (act === "zoom") { body.classList.toggle("pv-zoom"); b.textContent = body.classList.contains("pv-zoom") ? "適寬" : "放大"; showPage(pvPage, pvBlock); }
  });
  PR.pageStep = (d) => showPage(pvPage + d, pvBlock);
})(window.PR);
