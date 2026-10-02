/* 回收站：側欄最下面的“回收站”（有東西時才出現），點開列出刪掉的論文，可以恢復、徹底刪除、清空。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const dlg = () => PR.$("#trashDlg");
  let items = [];

  async function open() {
    items = (await PR.api("/api/trash")).items;
    render();
    dlg().classList.add("open");
  }

  function render() {
    const rows = items.map((t) => '<div class="trash-row"><div class="trash-t"><b>' + PR.esc(t.title_zh || t.title_en || t.id) + "</b>" +
      "<small>" + PR.esc([t.title_zh && t.title_en ? t.title_en : "", "刪除於 " + PR.shortTime(t.deleted)].filter(Boolean).join(" · ")) + "</small></div>" +
      '<button class="btn sm" data-tr="restore" data-name="' + PR.esc(t.name) + '">恢復</button>' +
      '<button class="btn sm danger" data-tr="purge" data-name="' + PR.esc(t.name) + '">徹底刪除</button></div>').join("");
    dlg().querySelector(".dialog").innerHTML = "<h2>回收站</h2>" +
      (items.length ? '<div class="trash-list">' + rows + "</div>" : '<p class="hint">回收站是空的。</p>') +
      '<div class="actions">' + (items.length ? '<button class="btn danger" data-tr="empty">清空回收站</button>' : "") +
      '<span class="grow"></span><button class="btn" data-tr="close">關閉</button></div>';
  }

  async function act(action, name, at) {
    if (action === "purge" && !(await PR.confirm({ title: "徹底刪除這篇？", body: "論文、譯文、筆記都會刪掉，不能恢復。", ok: "徹底刪除", danger: true, at }))) return;
    if (action === "empty" && !(await PR.confirm({ title: "清空回收站？", body: items.length + " 篇論文會被徹底刪除，不能恢復。", ok: "清空", danger: true, at }))) return;
    try {
      await PR.api("/api/trash", { method: "POST", body: { action, name } });
    } catch (e) { return PR.toast(PR.esc(e.message)); }
    items = action === "empty" ? [] : items.filter((t) => t.name !== name);
    render();
    await L.load();
    if (action === "restore") PR.toast("已恢復");
  }
  PR.restoreTrash = (name) => act("restore", name);

  dlg().addEventListener("click", (e) => {
    if (e.target === dlg()) return dlg().classList.remove("open");
    const b = e.target.closest("[data-tr]");
    if (!b) return;
    if (b.dataset.tr === "close") return dlg().classList.remove("open");
    act(b.dataset.tr, b.dataset.name, b);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dlg().classList.contains("open")) dlg().classList.remove("open"); });
  PR.$("#side").addEventListener("click", (e) => { if (e.target.closest("[data-trash]")) open(); });
})(window.PR);
