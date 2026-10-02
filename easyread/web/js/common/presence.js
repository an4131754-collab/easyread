/* 頁面開著就連著一條 WebSocket，讓服務知道還有人在用。
   用 start.cmd / start.sh 啟動時，頁面都關了、背景任務也做完了，服務會自己退出（見 easyread/presence.py）。 */
(function () {
  "use strict";
  if (location.protocol !== "http:" || typeof WebSocket === "undefined") return;
  let retries = 0;
  function connect() {
    let ws;
    try { ws = new WebSocket("ws://" + location.host + "/api/presence"); } catch (e) { return; }
    ws.onopen = () => { retries = 0; };
    ws.onclose = () => { retries += 1; setTimeout(connect, Math.min(30000, 1000 * retries)); };  // 斷了就重連（服務重啟過）
  }
  connect();
})();
