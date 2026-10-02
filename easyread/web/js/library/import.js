/* 匯入：對話方塊（選檔案 / 連結）+ 把 PDF 拖進視窗任何地方 + 在頁面上直接貼上連結。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const dlg = PR.$("#importDlg");
  const SCOPES = [["all", "全文"], ["body", "正文（到參考文獻為止）"], ["range", "指定頁"]];
  // 匯入後做什麼：翻譯成繁體中文 / 只讀英文原文（模型把版面排好，不翻譯）/ 只放原頁圖
  const AFTER = [["translate", "翻譯成繁體中文", "背景逐頁翻譯，正文是中文，隨時對照原文"],
    ["read", "讀英文原文", "不翻譯：模型只把公式、表格、段落排好，正文就是英文，比翻譯省用量；想看中文了隨時點“翻譯成繁體中文”"],
    ["none", "先不處理", "不用模型，閱讀頁先放原頁圖片"]];

  const pref = () => {
    const p = Object.assign({ auto: true, scope: "all", from: 1, to: 10 }, PR.ls.get("easyread-import", {}));
    if (p.scope === "first") Object.assign(p, { scope: "range", from: 1, to: p.first || 10 });  // 舊的“前幾頁”
    if (!p.after) p.after = p.auto ? "translate" : "none";  // 舊的“匯入後翻譯”勾選框
    return p;
  };
  const savePref = (p) => PR.ls.set("easyread-import", Object.assign(pref(), p));

  PR.openImport = function (ref) {
    const p = pref();
    const off = L.engine === "none";
    const after = off ? "none" : p.after;
    dlg.querySelector(".dialog").innerHTML =
      "<h2>匯入論文</h2>" +
      '<div class="dropzone" id="pick">' + PR.icon("upload") + '<div class="big">選擇 PDF，或拖到這裡</div><div class="hint">可以一次選多個；同一個檔案不會重複匯入</div></div>' +
      '<div class="or">或者</div>' +
      '<label class="field"><span>連結、arXiv 編號、DOI 或論文標題</span><div class="inline"><input class="input" id="arxivRef" placeholder="2411.00640 · 10.18653/v1/N19-1423 · 論文網頁連結 · 論文標題">' +
      '<button class="btn accent" id="arxivGo">匯入</button></div></label>' +
      '<div class="imp-opts"><span class="imp-lbl">匯入後</span><div class="seg" id="afterSeg">' + AFTER.map(([k, l, tip]) => '<button data-after="' + k + '" title="' + tip + '" class="' + (after === k ? "on" : "") + '"' + (off && k !== "none" ? " disabled" : "") + ">" + l + "</button>").join("") + "</div></div>" +
      '<div class="imp-opts' + (after === "none" ? " dim" : "") + '" id="scopeRow"><span class="imp-lbl">範圍</span><div class="seg" id="scopeSeg">' + SCOPES.map(([k, l]) => '<button data-scope="' + k + '" class="' + (p.scope === k ? "on" : "") + '">' + l + "</button>").join("") + "</div>" +
      '<span class="first-n"' + (p.scope === "range" ? "" : " hidden") + '>第 <input class="input" id="pgFrom" type="number" min="1" value="' + p.from + '"> 到 <input class="input" id="pgTo" type="number" min="1" value="' + p.to + '"> 頁</span></div>' +
      '<div class="imp-opts' + (after === "none" ? " dim" : "") + '" id="modelRow"><span class="imp-lbl">模型</span><select class="input" id="impModel">' +
      '<option value="">' + PR.esc(L.engineLabel || "未設定") + "</option></select>" +
      '<button class="linkish" id="impEngine" title="增刪模型在設定 → 模型">管理模型</button></div>' +
      '<div class="actions"><button class="btn" id="impClose">關閉</button></div>';
    dlg.classList.add("open");
    setTimeout(() => { const i = PR.$("#arxivRef"); if (ref) i.value = ref; i.focus(); }, 50);
    fillModels(p.model);
  };

  /* 模型：預設是設定裡的翻譯引擎，也可以直接選“問 AI”名單裡配好的模型 */
  async function fillModels(want) {
    let r;
    try { r = await PR.api("/api/chat/models"); } catch (e) { return; }
    const sel = PR.$("#impModel");
    if (!sel) return;
    // 標著“翻譯”的那張卡片就是空值（用設定裡的翻譯配置，包括“能看圖”）；對不上時才留第一項翻譯引擎
    if (r.translate) sel.innerHTML = "";
    sel.insertAdjacentHTML("beforeend", (r.models || []).map((m) =>
      '<option value="' + (m.id === r.translate ? "" : PR.esc(m.id)) + '"' + (m.ready ? "" : " disabled") + ">" + PR.esc(m.label + " · " + m.source) + "</option>").join(""));
    const ok = (r.models || []).some((m) => m.id === want && m.id !== r.translate && m.ready);
    sel.value = ok ? want : "";
  }
  const close = () => dlg.classList.remove("open");
  function opts() {
    const p = pref();
    const after = L.engine === "none" ? "none" : p.after;
    const from = Math.max(1, +p.from || 1), to = Math.max(1, +p.to || from);
    const scope = p.scope === "range" ? "range:" + Math.min(from, to) + "-" + Math.max(from, to) : p.scope;
    const sel = PR.$("#impModel");
    return { translate: after !== "none", read: after === "read", scope, model: after === "none" ? "" : sel ? sel.value : "" };
  }

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("#impClose")) close();
    if (e.target.closest("#pick")) PR.$("#fileInput").click();
    if (e.target.closest("#arxivGo")) importRef(PR.$("#arxivRef").value);
    if (e.target.closest("#impEngine")) { close(); PR.openSettings(); }
    const a = e.target.closest("[data-after]");
    if (a && !a.disabled) {
      savePref({ after: a.dataset.after });
      PR.$$("[data-after]", dlg).forEach((b) => b.classList.toggle("on", b === a));
      PR.$("#scopeRow").classList.toggle("dim", a.dataset.after === "none");
      PR.$("#modelRow").classList.toggle("dim", a.dataset.after === "none");
    }
    const s = e.target.closest("[data-scope]");
    if (s) {
      savePref({ scope: s.dataset.scope });
      PR.$$("[data-scope]", dlg).forEach((b) => b.classList.toggle("on", b === s));
      PR.$(".first-n", dlg).hidden = s.dataset.scope !== "range";
    }
  });
  dlg.addEventListener("change", (e) => { if (e.target.id === "impModel") savePref({ model: e.target.value }); });
  dlg.addEventListener("input", (e) => {  // 邊輸邊存：輸完直接點“匯入”也用新的頁碼
    if (e.target.id === "pgFrom") savePref({ from: +e.target.value || 1 });
    if (e.target.id === "pgTo") savePref({ to: +e.target.value || 1 });
  });
  dlg.addEventListener("keydown", (e) => { if (e.target.id === "arxivRef" && e.key === "Enter") importRef(e.target.value); if (e.key === "Escape") close(); });
  PR.$("#importBtn").onclick = () => PR.openImport();
  PR.$("#fileInput").addEventListener("change", (e) => { importFiles(Array.from(e.target.files)); e.target.value = ""; });

  async function importFiles(files) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!pdfs.length) return PR.toast("只支援 PDF 檔案");
    close();
    const o = opts();
    let last = null;
    for (const [k, f] of pdfs.entries()) {
      PR.toast("正在匯入 " + (k + 1) + "/" + pdfs.length + "：" + PR.esc(f.name), null, 60000);
      try {
        const r = await PR.api("/api/import?translate=" + (o.translate ? 1 : 0) + "&read=" + (o.read ? 1 : 0) + "&model=" + encodeURIComponent(o.model) + "&scope=" + encodeURIComponent(o.scope) + "&name=" + encodeURIComponent(f.name), { method: "POST", body: f });
        last = r.id;
        if (!r.new) PR.toast("《" + PR.esc(f.name) + "》" + (r.queued ? "已重新加入準備佇列" : "已經在庫裡了"));
      } catch (e) { PR.toast("匯入失敗：" + PR.esc(e.message)); }
    }
    await L.load();
    if (last) { L.select(last); PR.toast("已匯入 " + pdfs.length + " 篇" + (o.read ? "，背景開始整理原文" : o.translate ? "，背景開始翻譯" : ""), { label: "開啟", fn: () => L.openReader(last) }, 6000); }
  }

  async function importRef(ref) {
    ref = (ref || "").trim();
    if (!ref) return;
    const btn = PR.$("#arxivGo");
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 查詢中'; }
    else PR.toast('<span class="spin"></span> 正在查詢並下載 ' + PR.esc(ref), null, 60000);
    const o = opts();
    try {
      const r = await PR.api("/api/import-url", { method: "POST", body: { ref, translate: o.translate, read: o.read, model: o.model, scope: o.scope } });
      close();
      await L.load();
      L.select(r.id);
      PR.toast(r.new ? "已匯入" + (o.read ? "，背景開始整理原文" : o.translate ? "，背景開始翻譯" : "") : r.queued ? "已重新加入準備佇列" : "這篇已經在庫裡了", { label: "開啟", fn: () => L.openReader(r.id) }, 6000);
    } catch (e) {
      PR.toast("匯入失敗：" + PR.esc(e.message), null, 8000);
      if (btn) { btn.disabled = false; btn.textContent = "匯入"; }
    }
  }
  PR.importRef = importRef;

  /* 在文獻庫頁面直接 Ctrl+V 一個連結或 arXiv 編號 */
  document.addEventListener("paste", (e) => {
    if (e.target.closest("input, textarea, [contenteditable]") || PR.$(".dialog-backdrop.open")) return;
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); return importFiles(files); }
    const t = (e.clipboardData.getData("text") || "").trim();
    if (/^(https?:\/\/\S+|(arxiv:)?\d{4}\.\d{4,5}(v\d+)?|(doi:\s*)?10\.\d{4,9}\/\S+)$/i.test(t)) { e.preventDefault(); PR.openImport(t); }
  });

  /* 拖進視窗任何地方都能匯入 */
  let depth = 0;
  const overlay = PR.$("#dropOverlay");
  const hasFiles = (e) => Array.from(e.dataTransfer && e.dataTransfer.types || []).includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; overlay.classList.add("on"); });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove("on"); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.classList.remove("on");
    importFiles(Array.from(e.dataTransfer.files));
  });
})(window.PR);
