/* 翻譯和問 AI 的用量（job.json 的 usage / usage_total，對話裡每條回答的 usage）。
   樣子學 Claude 桌面端：訂閱額度用進度條 + 什麼時候重置；token 數做成小號的明細。 */
window.PR = window.PR || {};
(function (PR) {
  "use strict";

  function tokens(n) {
    n = Number(n) || 0;
    if (n < 10000) return n.toLocaleString();
    return (n / 10000).toFixed(n < 1e6 ? 1 : 0).replace(/\.0$/, "") + " 萬";
  }
  PR.fmtTokens = tokens;

  const WINDOWS = [["five_hour", "5 小時額度"], ["seven_day", "本週額度"]];
  const pct = (x) => Math.round(x * 100) + "%";
  const level = (x) => (x >= 0.95 ? "full" : x >= 0.8 ? "high" : "");

  function resetText(ts) {
    if (!ts) return "";
    const ms = ts * 1000 - Date.now();
    if (ms <= 0) return "已重置";
    const h = Math.floor(ms / 3.6e6), m = Math.round((ms % 3.6e6) / 6e4);
    if (h < 24) return (h ? h + " 小時 " : "") + m + " 分鐘後重置";
    const d = new Date(ts * 1000);
    return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 周" + "日一二三四五六"[d.getDay()] + " " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + " 重置";
  }

  /* 額度進度條（Claude 訂閱才有），排版學 Claude 桌面端：名字在左，“幾小時後重置 + 百分比”在右，下面一根細條。
     額度是整個帳號共用的，同時用 Claude Code 幹別的也算在裡面，所以不拿前後相減去算翻譯用了多少 */
  PR.usageBars = function (limits, title) {
    const rows = WINDOWS.filter(([k]) => limits && limits[k] && limits[k].used != null).map(([k, name]) => {
      const w = limits[k];
      const stale = w.resets_at && w.resets_at * 1000 <= Date.now();  // 記下的是重置前的數，已經不準了
      return '<div class="us-limit ' + (stale ? "stale" : level(w.used)) + '"><div class="us-row"><span>' + name + "</span>" +
        "<em>" + (stale ? "已重置，當時 " + pct(w.used) : resetText(w.resets_at) + "<b>" + pct(w.used) + "</b>") + "</em></div>" +
        '<div class="us-bar"><i style="width:' + (stale ? 0 : Math.min(100, w.used * 100)) + '%"></i></div></div>';
    });
    return rows.length ? '<div class="us-limits">' + (title ? '<div class="us-head">' + title + "</div>" : "") + rows.join("") + "</div>" : "";
  };

  function ago(at) {
    const m = Math.round((Date.now() / 1000 - at) / 60);
    return m < 1 ? "剛剛" : m < 60 ? m + " 分鐘前" : m < 1440 ? Math.round(m / 60) + " 小時前" : Math.round(m / 1440) + " 天前";
  }

  /* token 明細：右邊大數字，下面一行小字 */
  PR.usageTokens = function (label, u) {
    if (!u || !u.calls) return "";
    return '<div class="us-tokens"><div class="us-row"><span>' + label + "</span><b>" + tokens(u.input + u.output) + " token</b></div>" +
      '<div class="us-split">輸入 ' + tokens(u.input) + (u.cached ? "（快取命中 " + tokens(u.cached) + "）" : "") + " · 輸出 " + tokens(u.output) +
      (u.cost_usd != null && !u.limits ? " · 按官方價約 $" + u.cost_usd.toFixed(2) : "") + "</div></div>";
  };

  /* 翻譯進度旁邊的一句話：“已用 12.3 萬 token · 5 小時額度用到 24%” */
  PR.usageShort = function (u) {
    if (!u || !u.calls) return "";
    const five = u.limits && u.limits.five_hour;
    return "已用 " + tokens(u.input + u.output) + " token" + (five && five.used != null ? " · 5 小時額度用到 " + pct(five.used) : "");
  };

  /* 論文詳情裡的用量卡片：上次翻譯、這篇累計、譯完時的額度 */
  PR.usageCard = function (u, total) {
    if (!u || !u.calls) return "";
    return '<div class="us-card">' + PR.usageTokens("上次翻譯", u) +
      (total && total.calls > u.calls ? PR.usageTokens("這篇累計", total) : "") +
      PR.usageBars(u.limits, "Claude 訂閱用量（譯完時，整個帳號共用）") + "</div>";
  };

  /* 問 AI：整個對話的合計 */
  function threadSum(msgs) {
    const used = (msgs || []).map((m) => m.usage).filter((u) => u && u.calls);
    if (!used.length) return null;
    const sum = { calls: 0, input: 0, cached: 0, output: 0 };
    used.forEach((u) => { sum.calls += u.calls; sum.input += u.input; sum.cached += u.cached; sum.output += u.output; });
    return sum;
  }

  /* 對話輸入框底部的小圓環。latest：服務端記下的最近一次額度 {limits, at}，新對話也有；
     沒用過 Claude 訂閱時只寫這個對話的 token 數 */
  PR.usageChip = function (latest, msgs, open) {
    const five = latest && latest.limits && latest.limits.five_hour;
    const live = five && five.used != null && !(five.resets_at && five.resets_at * 1000 <= Date.now());
    const cls = "us-chip" + (open ? " on" : "");
    if (live) {
      const r = 6, c = 2 * Math.PI * r, v = Math.min(1, five.used);
      return '<button class="' + cls + " " + level(v) + '" data-c="usage" title="用量">' +
        '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="' + r + '" class="track"/>' +
        '<circle cx="8" cy="8" r="' + r + '" class="fill" stroke-dasharray="' + (c * v).toFixed(2) + " " + c.toFixed(2) + '" transform="rotate(-90 8 8)"/></svg>' +
        "<span>" + pct(v) + "</span></button>";
    }
    const sum = threadSum(msgs);
    if (sum) return '<button class="' + cls + '" data-c="usage" title="用量"><span>' + tokens(sum.input + sum.output) + " token</span></button>";
    return latest && latest.limits ? '<button class="' + cls + '" data-c="usage" title="用量"><span>用量</span></button>' : "";
  };

  /* 上下文條（學 Claude 的 Context window）：最近一次回答時發給模型的全部內容。每次提問都會連同之前的對話一起發，
     所以看的是“當前對話多大”，不是累計。分三段：快取命中的（系統提示、之前的對話）、這次新發的、模型的回答。
     不知道模型上下文多大時（API、Codex），條按 20 萬算，右邊只寫 token 數 */
  function contextHtml(msgs) {
    const last = (msgs || []).map((m) => m.usage).filter((u) => u && u.calls && u.context).pop();
    if (!last) return '<div class="us-ctx"><div class="us-row"><span>上下文</span><em>還沒提問</em></div><div class="us-bar"></div></div>';
    const c = last.context, total = c.cached + c.fresh + c.output, win = last.context_window;
    const scale = win || Math.max(200000, total);
    const seg = (n, cls, name) => n > 0 ? '<i class="' + cls + '" style="width:' + Math.max(0.6, (n / scale) * 100) + '%" title="' + name + " " + tokens(n) + '"></i>' : "";
    return '<div class="us-ctx"><div class="us-row"><span>上下文</span><em>' + tokens(total) + (win ? " / " + tokens(win) + "（" + Math.max(1, Math.round((total / win) * 100)) + "%）" : " token") + "</em></div>" +
      '<div class="us-bar us-stack">' + seg(c.cached, "cached", "快取命中（系統提示、之前的對話）") + seg(c.fresh, "fresh", "這次新發的（問題、引用的段落）") + seg(c.output, "out", "回答") + "</div>" +
      '<div class="us-legend"><span><i class="cached"></i>快取命中</span><span><i class="fresh"></i>新發送</span><span><i class="out"></i>回答</span></div></div>';
  }

  /* 點圓環彈出的用量面板 */
  PR.usagePop = function (latest, msgs) {
    const bars = latest && latest.limits ? PR.usageBars(latest.limits, "Claude 訂閱用量") : "";
    return '<div class="us-pop">' + contextHtml(msgs) + bars +
      (bars ? '<div class="us-foot">整個帳號共用，含其他用途 · 更新於 ' + ago(latest.at) + "</div>" : "") + "</div>";
  };
})(window.PR);
