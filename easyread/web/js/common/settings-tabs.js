/* 設定的另外兩頁：閱讀（功能開關、主題）、快捷鍵（總開關、改鍵）。 */
(function (PR) {
  "use strict";
  const T = PR.settingsTabs;

  /* ---------- 閱讀 ---------- */
  /* 排版：和閱讀頁 Aa 面板是同一份設定，這裡多一個“恢復預設” */
  function typeHtml(s) {
    if (!s.type) s.type = Object.assign({}, PR.TYPE_DEFAULTS, PR.ls.get("easyread-prefs", {}));
    const t = s.type, range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push([+v.toFixed(2), +v.toFixed(2)]); return out; };
    const sel = (key, label, list) => '<label class="field"><span>' + label + '</span><select class="input" data-type="' + key + '">' + PR.opt(list, t[key]) + "</select></label>";
    return '<h4 class="set-h">排版</h4><div class="settings-sec grid3">' +
      sel("fs", "字號", range(13, 28, 1).map(([v]) => [v, v + " px"])) + sel("measure", "版心（每行字數）", range(26, 50, 1).map(([v]) => [v, v + " 字"])) +
      sel("lh", "行距", range(1.5, 2.4, 0.05)) + sel("font", "字型", [["serif", "宋體"], ["sans", "黑體"]]) +
      sel("mode", "開啟時顯示", [["zh", "譯文"], ["bi", "對照"]]) + sel("margin", "邊注", [["true", "顯示"], ["false", "收起"]]) +
      '</div><div class="keys-foot" style="margin-top:4px"><span class="hint">閱讀時也能在右上角 Aa 裡隨手調。</span><button class="btn sm" data-type-reset>恢復預設排版</button></div>';
  }
  T.reading = {
    render(s) {
      return typeHtml(s) + '<h4 class="set-h">功能</h4><p class="set-lead">閱讀頁上顯示哪些功能。關掉的功能，按鈕和快捷鍵都會一起消失。</p><div class="switch-list">' +
        PR.FEATURES.map(([id, name, , desc]) => '<label class="switch-row"><span><b>' + name + "</b><small>" + desc + '</small></span><input type="checkbox" class="switch" data-feat="' + id + '"' + (s.ui.features[id] !== false ? " checked" : "") + "></label>").join("") +
        "</div>" + '<div class="settings-sec grid2"><label class="field"><span>介面主題</span><select class="input" id="themeSel">' +
        PR.opt([["auto", "跟隨系統"], ["light", "淺色"], ["dark", "深色"]], s.theme) + "</select></label></div>";
    },
    click(e, s) {
      if (!e.target.closest("[data-type-reset]")) return false;
      s.type = Object.assign({}, PR.TYPE_DEFAULTS);
      return true;
    },
    change(e, s) {
      const t = e.target.dataset.type;
      if (t) s.type[t] = t === "margin" ? e.target.value === "true" : ["fs", "measure", "lh"].includes(t) ? +e.target.value : e.target.value;
      if (e.target.dataset.feat) s.ui.features[e.target.dataset.feat] = e.target.checked;
      if (e.target.id === "themeSel") { s.theme = e.target.value; PR.applyTheme(s.theme); }
      return false;
    },
  };

  /* ---------- 快捷鍵 ---------- */
  T.keys = {
    render(s) {
      let h = '<label class="switch-row big"><span><b>啟用快捷鍵</b><small>關掉後只剩 Esc。單個字母的快捷鍵打字時不會觸發，但點著頁面時按到會觸發。</small></span><input type="checkbox" class="switch" id="keysOn"' + (s.ui.keys_on ? " checked" : "") + "></label>";
      h += '<div class="keys-list' + (s.ui.keys_on ? "" : " dim") + '">';
      let grp = "";
      for (const [id, label, , group, need] of PR.KEY_ACTIONS) {
        if (group !== grp) { h += '<div class="grp">' + group + "</div>"; grp = group; }
        const off = need && s.ui.features[need] === false;
        const k = s.ui.keys[id];
        h += "<span>" + label + (off ? ' <small class="hint">（功能已關）</small>' : "") + '</span><button class="kcap' + (s.recording === id ? " rec" : k ? "" : " off") + '" data-krec="' + id + '">' +
          (s.recording === id ? "按一個鍵…" : k ? PR.esc(PR.keyName(k)) : "未設定") + '</button><button class="kx" data-koff="' + id + '" title="不用這個快捷鍵">清除</button>';
      }
      return h + '</div><div class="keys-foot"><span class="hint">選中文字後 1–4 四色劃線、N 筆記、Q 提問，跟著總開關。</span><button class="btn sm" data-kreset>恢復預設鍵位</button></div>';
    },
    click(e, s) {
      const r = e.target.closest("[data-krec]"), off = e.target.closest("[data-koff]");
      if (r) { s.recording = s.recording === r.dataset.krec ? null : r.dataset.krec; return true; }
      if (off) { s.ui.keys[off.dataset.koff] = ""; s.recording = null; return true; }
      if (e.target.closest("[data-kreset]")) { s.ui.keys = PR.defaultKeys(); s.recording = null; return true; }
      return false;
    },
    change(e, s) { if (e.target.id === "keysOn") { s.ui.keys_on = e.target.checked; return true; } return false; },
    key(e, s) {
      if (e.key === "Escape") { s.recording = null; return true; }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return false;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (/^[1-4]$/.test(k)) { PR.toast("1–4 留給選中文字後的劃線"); return false; }
      const taken = Object.keys(s.ui.keys).find((id) => s.ui.keys[id] === k && id !== s.recording);
      if (taken) { s.ui.keys[taken] = ""; PR.toast("「" + PR.KEY_ACTIONS.find((a) => a[0] === taken)[1] + "」原來的鍵讓給了這個操作"); }
      s.ui.keys[s.recording] = k;
      s.recording = null;
      return true;
    },
  };
})(window.PR);
