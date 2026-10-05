/* 新版本提示：開啟文獻庫時問一次服務（服務一天最多問一次 GitHub），有新版本就在頂欄放一個“新版本 x.y.z”，
   第一次看到這個版本時再彈一條提示。點開看這次更新了什麼、去哪下載；可以跳過這個版本。
   幫助裡有“檢查更新”和“自動檢查新版本”開關。 */
(function (PR) {
  "use strict";
  const SKIP = "easyread-skip-update", SEEN = "easyread-seen-update";
  const desktop = /Electron/i.test(navigator.userAgent);
  const bridge = window.easyreadDesktop;
  let nativeState = { supported: false, phase: "idle", percent: 0, error: "" };
  let actionPending = false;
  PR.update = null;

  const chip = PR.el("button", { class: "engine-chip update-chip", id: "updateChip", hidden: "" });
  PR.$("#engineChip").before(chip);
  chip.onclick = () => PR.openUpdate();

  /* Release 說明是 Markdown：只認段落、“- ”列表、**粗體**、[連結](地址)、`程式碼`，夠用了 */
  function inline(s) {
    return PR.esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s（(])(https?:\/\/[^\s<）)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  }
  function notesHtml(md) {
    let h = "", list = false;
    for (const raw of (md || "").split(/\r?\n/)) {
      const line = raw.trim();
      const li = line.match(/^[-*] (.*)/);
      if (li) { if (!list) { h += "<ul>"; list = true; } h += "<li>" + inline(li[1]) + "</li>"; continue; }
      if (list) { h += "</ul>"; list = false; }
      if (!line) continue;
      const head = line.match(/^#{1,4} (.*)/);
      h += head ? "<h4>" + inline(head[1]) + "</h4>" : "<p>" + inline(line) + "</p>";
    }
    return h + (list ? "</ul>" : "");
  }

  function howTo() {
    return desktop ? "下載對應系統的安裝包，裝上就會覆蓋舊版本，論文和設定都還在。"
      : "從原始碼執行的：下載新版 zip 解壓後雙擊 start.cmd（macOS / Linux 執行 ./start.sh），或者在專案目錄裡 git pull；用 pip 裝的：pip install -U easyread。論文和設定在資料目錄裡，不受影響。";
  }

  function updateControls() {
    const root = PR.$("#textDlg"), status = root.querySelector("[data-update-status]"), button = root.querySelector('[data-up="install"]');
    if (!status || !button) return;
    const phase = nativeState.phase;
    const pct = Math.max(0, Math.min(100, Number(nativeState.percent) || 0));
    const messages = { checking: "正在檢查更新…", downloading: "正在下載更新 " + Math.round(pct) + "%", downloaded: "下載完成，準備安裝", installing: "正在關閉服務並安裝，完成後會重新開啟", current: "目前已是最新版本", error: "更新未完成" };
    status.innerHTML = '<p role="status" aria-live="polite">' + PR.esc(messages[phase] || "下載完成後會自動重新啟動並安裝。請先儲存目前工作。") + '</p>' +
      (phase === "downloading" ? '<progress class="update-progress" max="100" value="' + pct + '" aria-label="下載更新進度"></progress>' : "") +
      (nativeState.error ? '<p class="update-error" role="alert">' + PR.esc(nativeState.error) + '</p>' : "");
    button.disabled = actionPending || ["checking", "downloading", "installing"].includes(phase);
    button.textContent = phase === "downloaded" ? "重新啟動並安裝" : phase === "error" ? "重試更新" : "下載並更新";
  }
  if (bridge && bridge.updateState && bridge.onUpdateState) {
    bridge.onUpdateState(state => { nativeState = state; updateControls(); });
    bridge.updateState().then(state => { nativeState = state; updateControls(); }).catch(() => {});
  }
  async function installUpdate() {
    if (actionPending) return;
    actionPending = true;
    updateControls();
    try {
      if (nativeState.phase !== "downloaded") nativeState = await bridge.downloadUpdate();
      if (nativeState.phase === "downloaded") nativeState = await bridge.installUpdate();
    } catch (error) { nativeState = { ...nativeState, phase: "error", error: error.message }; }
    finally { actionPending = false; updateControls(); }
  }

  function show(u) {
    PR.update = u;
    const on = !!(u && u.newer && PR.ls.get(SKIP, "") !== u.latest);
    chip.hidden = !on;
    if (!on) return;
    chip.innerHTML = '<span class="dot"></span><span>新版本 ' + PR.esc(u.latest) + "</span>";
    chip.title = "EasyRead " + u.latest + " 已釋出，點開看更新了什麼";
    if (PR.ls.get(SEEN, "") !== u.latest) {  // 每個新版本只彈一次
      PR.ls.set(SEEN, u.latest);
      PR.toast("EasyRead " + PR.esc(u.latest) + " 釋出了", { label: "看看更新了什麼", fn: PR.openUpdate }, 9000);
    }
  }

  PR.openUpdate = function () {
    const u = PR.update;
    if (!u || !u.latest) return;
    const dlg = PR.$("#textDlg");
    dlg.querySelector(".dialog").innerHTML =
      '<div class="help-head">' + PR.logo("hero sm") + "<div><h2>EasyRead " + PR.esc(u.latest) + (u.newer ? " 可以更新了" : "") + '</h2><div class="hint">你現在用的是 ' + PR.esc(u.current) +
      (u.published ? " · " + PR.esc(u.published.slice(0, 10)) + " 釋出" : "") + "</div></div></div>" +
      '<div class="update-notes">' + (notesHtml(u.notes) || '<p class="hint">這次沒寫更新說明。</p>') + "</div>" +
      (u.newer ? '<p class="hint">' + (nativeState.supported ? "Windows 桌面版可在這裡下載並安裝更新；正在翻譯、回答或儲存時會暫停安裝，稍後可重試。" : howTo()) + "</p>" : "") +
      (u.newer && nativeState.supported ? '<div data-update-status></div>' : "") +
      '<div class="actions">' + (u.newer ? '<button class="btn" data-up="skip">跳過這個版本</button>' : "") + '<button class="btn" data-close>關閉</button>' +
      (u.newer && nativeState.supported ? '<button class="btn accent" data-up="install">下載並更新</button>' : "") +
      '<a class="btn' + (nativeState.supported && u.newer ? "" : " accent") + '" href="' + PR.esc(u.url) + '" target="_blank" rel="noopener">' + (u.newer ? nativeState.supported ? "手動下載" : "去下載" : "在 GitHub 上看") + "</a></div>";
    dlg.classList.add("open");
    updateControls();
  };

  PR.$("#textDlg").addEventListener("click", (e) => {
    if (e.target.closest('[data-up="install"]')) { installUpdate(); return; }
    if (!e.target.closest('[data-up="skip"]')) return;
    PR.ls.set(SKIP, PR.update.latest);
    PR.$("#textDlg").classList.remove("open");
    show(PR.update);
    PR.toast("不再提示 " + PR.esc(PR.update.latest) + "，有更新的版本時再告訴你");
  });

  /* 幫助裡用：force 為真時馬上問 GitHub */
  PR.checkUpdate = async function (force) {
    const u = await PR.api("/api/update" + (force ? "?force=1" : ""));
    if (force) PR.ls.set(SKIP, "");  // 手動檢查：之前跳過的版本也重新提示
    show(u);
    return u;
  };
  PR.setAutoUpdate = async function (on) {
    show(await PR.api("/api/update", { method: "POST", body: { enabled: on } }));
  };

  setTimeout(() => PR.checkUpdate(false).catch(() => {}), 1500);  // 等文獻庫先顯示出來
})(window.PR);
