/* 閱讀頁快捷鍵的執行。鍵位、總開關和功能開關在 common/features.js，改鍵在“設定 → 快捷鍵”。
   選中文字後的 1–4 劃線、N 筆記、Q 提問，和 Esc 關閉，只受總開關控制。 */
(function (PR) {
  "use strict";
  PR.runAction = function (id) {
    const g = {
      mode: () => PR.setPref("mode", PR.prefs.mode === "bi" ? "zh" : "bi"),
      toc: () => PR.toggleDrawer(null, "toc"),
      fontUp: () => PR.bumpFont(1), fontDown: () => PR.bumpFont(-1), fontReset: () => PR.resetType(),
      pages: () => PR.togglePages(), notes: () => PR.toggleNotesPanel(),
      chat: () => { const b = (PR.currentBlock && PR.currentBlock()) || PR.readingBlock(); PR.blockById[b] ? PR.chatAsk({ anchor: b }) : PR.toggleChat(); },
      pagePrev: () => PR.pageStep(-1), pageNext: () => PR.pageStep(1),
    }[id];
    if (g) { g(); return true; }
    return PR.blockAction(id);
  };
})(window.PR);
