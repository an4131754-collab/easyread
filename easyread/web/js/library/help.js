/* 幫助：快捷鍵、怎麼用、關於。按 ? 或點頂欄問號開啟。 */
(function (PR) {
  "use strict";
  const dlg = PR.$("#textDlg");
  const K = (keys, what) => "<tr><td>" + keys.split(" ").map((k) => "<kbd>" + k + "</kbd>").join(" ") + "</td><td>" + what + "</td></tr>";

  PR.openHelp = function () {
    dlg.querySelector(".dialog").innerHTML =
      '<div class="help-head">' + PR.logo("hero sm") + "<div><h2>EasyRead</h2><div class=\"hint\">版本 " + PR.esc(PR.lib.version || "") + " · 本地執行，論文和筆記只存在你的電腦上</div></div></div>" +
      '<div class="help-update"><button class="btn sm line" data-help="check">檢查更新</button><span class="hint" id="helpUpdateMsg">' + updateLine() + "</span>" +
      '<label class="check"><input type="checkbox" data-help="auto"' + (!PR.update || PR.update.enabled !== false ? " checked" : "") + ">自動檢查新版本（一天一次，只問 GitHub）</label></div>" +
      '<div class="help-cols"><div><h4>文獻庫</h4><table class="keys">' +
      K("/", "搜尋") + K("J K", "上下移動") + K("Enter", "開啟閱讀") + K("S", "星標") + K("Ctrl+V", "貼上連結直接匯入") + K("?", "這個幫助") +
      "</table><h4>匯入</h4><p class=\"hint\">拖 PDF 進視窗；或填 arXiv 編號、DOI、論文標題、論文網頁（arXiv、OpenReview、ACL、NeurIPS、bioRxiv、PMC、期刊頁面）或 PDF 直鏈。找不到公開 PDF 的，下載後拖進來。長論文可以只譯正文。</p>" +
      "<h4>翻譯引擎</h4><p class=\"hint\">本機裝了 Claude Code 或 Codex 就能直接用，不用 Key；也可以用 DeepSeek、智譜、通義、Gemini 等 API，或本機 Ollama。在設定裡換。</p></div>" +
      '<div><h4>閱讀頁</h4><table class="keys">' +
      K("J K", "下一段 / 上一段") + K("N Q", "給當前段寫筆記 / 提問") + K("A", "問 AI（帶當前段）") + K("E", "改譯文") + K("R", "讓模型重譯這段") +
      K("B", "譯文 / 對照原文") + K("O", "原文頁面板") + K("M", "筆記面板") + K("T", "目錄") + K("= - 0", "字號大 / 小 / 預設") + K("1 2 3 4", "選中文字後四色劃線") +
      "</table></div></div>" +
      '<div class="actions"><button class="btn" data-close>關閉</button></div>';
    dlg.classList.add("open");
  };
  function updateLine() {
    const u = PR.update;
    if (!u) return "";
    if (u.newer) return '有新版本 <a href="#" data-help="open">' + PR.esc(u.latest) + "</a>";
    return u.latest ? "已經是最新版" : "";
  }
  dlg.addEventListener("click", async (e) => {
    const b = e.target.closest('[data-help="check"], [data-help="open"]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.help === "open") return PR.openUpdate();
    const msg = PR.$("#helpUpdateMsg");
    b.disabled = true; msg.textContent = "正在檢查…";
    try {
      const u = await PR.checkUpdate(true);
      msg.innerHTML = u.latest ? updateLine() : "沒連上 GitHub，稍後再試";
    } catch (err) { msg.textContent = "檢查失敗：" + err.message; }
    b.disabled = false;
  });
  dlg.addEventListener("change", (e) => {
    if (e.target.dataset.help === "auto") PR.setAutoUpdate(e.target.checked).catch((err) => PR.toast("儲存失敗：" + PR.esc(err.message)));
  });
  PR.$("#helpBtn").onclick = PR.openHelp;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.target.closest("input, textarea, select, [contenteditable]") || PR.$(".dialog-backdrop.open")) return;
    e.preventDefault();
    PR.openHelp();
  });
})(window.PR);
