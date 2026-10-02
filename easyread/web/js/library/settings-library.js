/* 設定 → 側邊欄：管理文獻庫左側欄裡的分類。
   內建分類和自建分類用同一種行：開關決定在側欄顯示還是隱藏，圖釘按鈕置頂；自建分類還能改名、刪除。
   “全部”始終顯示。改動立刻生效（和在側欄右鍵操作一樣），不用等“儲存”。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const BUILTIN = [["reading", "在讀"], ["unread", "未讀"], ["done", "已讀"], ["starred", "星標"],
    ["questions", "有待回答的問題", "有問題沒回答時才出現"], ["translating", "翻譯中", "有論文在翻譯時才出現"]];

  function row(o) {  // o: {name, sub, pinKey, hideKey, custom, fixed}
    const pinned = o.pinKey && L.side.pinned.includes(o.pinKey);
    if (o.renaming) return '<div class="sb-row"><input class="input" id="libRenameInput" value="' + PR.esc(o.name) + '" maxlength="30"><button class="btn sm accent" data-lib="rename-ok" data-c="' + PR.esc(o.name) + '">好</button><button class="btn sm" data-lib="cancel">取消</button></div>';
    return '<div class="sb-row"><span class="sb-name">' + PR.icon(o.custom ? "folder" : "book", "sm") + "<b>" + PR.esc(o.name) + "</b>" + (o.sub ? "<small>" + PR.esc(o.sub) + "</small>" : "") + "</span>" +
      (o.custom ? '<button class="btn sm" data-lib="rename" data-c="' + PR.esc(o.name) + '">改名</button><button class="btn sm danger" data-lib="del" data-c="' + PR.esc(o.name) + '">刪除</button>' : "") +
      (o.pinKey ? '<button class="sb-pin' + (pinned ? " on" : "") + '" data-lib="pin" data-key="' + PR.esc(o.pinKey) + '" title="' + (pinned ? "取消置頂" : "置頂到側欄最上面") + '">' + PR.icon("pin", "sm") + "</button>" : '<span class="sb-pin-space"></span>') +
      '<input type="checkbox" class="switch" title="在側欄顯示"' + (o.fixed ? " checked disabled" : ' data-libshow="' + PR.esc(o.hideKey) + '"' + (L.side.hidden.includes(o.hideKey) ? "" : " checked")) + "></div>";
  }

  PR.settingsTabs.library = {
    render(s) {
      const count = (fn) => L.items.filter(fn).length;
      const cats = L.cats();
      return '<p class="set-lead">文獻庫左側欄裡顯示哪些分類。開關控制顯示或隱藏，圖釘是置頂。一篇論文可以放進好幾個分類：在論文上右鍵，或者把它拖到側欄的分類上。改動立刻生效。</p>' +
        '<h4 class="set-h">內建分類</h4><div class="sb-list">' +
        row({ name: "全部", sub: "始終顯示", fixed: true }) +
        BUILTIN.map(([k, name, note]) => row({ name, sub: note || count((L.VIEWS.find((v) => v[0] === k) || [])[3] || (() => false)) + " 篇", pinKey: "v:" + k, hideKey: k })).join("") + "</div>" +
        '<h4 class="set-h">我的分類</h4><div class="sb-list">' +
        (cats.map((c) => row({ name: c, sub: count((x) => (x.tags || []).includes(c)) + " 篇", pinKey: "c:" + c, hideKey: "c:" + c, custom: true, renaming: s.libRename === c })).join("") || '<p class="hint">還沒有自建分類。</p>') +
        '</div><div class="cm-form-acts" style="margin-top:10px"><input class="input" id="libNewInput" placeholder="新分類的名字" maxlength="30" style="max-width:240px"><button class="btn sm line" data-lib="add">' + PR.icon("plus", "sm") + "新建分類</button></div>";
    },
    async click(e, s) {
      const b = e.target.closest("[data-lib]");
      if (!b) return false;
      const c = b.dataset.c, act = b.dataset.lib;
      if (act === "add") L.addCat(PR.$("#libNewInput").value);
      if (act === "pin") L.togglePin(b.dataset.key);
      if (act === "rename") s.libRename = c;
      if (act === "cancel") s.libRename = null;
      if (act === "rename-ok") { L.renameCat(c, PR.$("#libRenameInput").value); s.libRename = null; }
      if (act === "del") await L.deleteCat(c, b);
      return true;
    },
    change(e) {
      if (e.target.dataset.libshow) L.setHidden(e.target.dataset.libshow, !e.target.checked);
      return false;
    },
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "libNewInput") { e.preventDefault(); PR.$('[data-lib="add"]').click(); }
    if (e.target.id === "libRenameInput") { e.preventDefault(); PR.$('[data-lib="rename-ok"]').click(); }
  }, true);
})(window.PR);
