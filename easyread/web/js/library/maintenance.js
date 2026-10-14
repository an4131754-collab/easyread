/* 論文維護入口：完整備份、手動 PDF 更新與恢復。 */
(function (PR) {
  "use strict";
  PR.paperMaintenanceHtml = (i) => '<div class="row2" style="margin:12px 0"><button class="btn sm line" data-maint="backup">完整備份</button><button class="btn sm line" data-maint="restore">從備份恢復</button>' +
    (i.load_error ? '' : '<button class="btn sm line" data-maint="refresh-pdf">更新 PDF 定位與裁圖</button>') + '</div>';
  const box = PR.$('#detail');
  box.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-maint]'), i = PR.lib.byId(PR.lib.selected);
    if (!button || !i) return;
    const base = '/api/p/' + i.id + '/', action = button.dataset.maint;
    const post = async (path, body = {}) => {
      try {
        button.disabled = true;
        const r = await PR.api(base + path, { method: 'POST', body });
        PR.toast('完成；恢復前／更新前資料已完整備份。');
        await PR.lib.load();
        return r;
      } catch (err) { PR.toast(err.message); }
      finally { button.disabled = false; }
    };
    if (action === 'restore') {
      try {
        const r = await PR.api(base + 'backups');
        if (!r.items.length) { PR.toast('沒有完整備份可用。原檔已保留，可開啟論文資料夾尋找其他備份或聯絡維護者。'); return; }
        PR.menu(button, r.items.map(b => ({ label: b.name, icon: 'history', fn: async () => {
          if (await PR.confirm({title:'從完整備份恢復？', body:'請先儲存並關閉這篇的閱讀頁。將恢復論文、定位、圖片、筆記及聊天；目前資料也會先完整保留。',ok:'備份現況並恢復',at:button})) await post('restore-backup', {name:b.name});
        }})));
      } catch (err) { PR.toast(err.message); }
      return;
    }
    if (action === 'refresh-pdf' && !(await PR.confirm({title:'更新這篇的 PDF 定位與裁圖？',body:'先完整備份，再更新定位及圖片。原文、譯文、筆記與聊天會保留，不呼叫翻譯模型。請先關閉這篇閱讀頁。',ok:'備份並更新',at:button}))) return;
    await post(action);
  });
})(window.PR);
