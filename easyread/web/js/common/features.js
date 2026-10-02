/* 功能開關和快捷鍵（文獻庫頁、閱讀頁、設定共用）。
   存在本機 prefs.json：ui.features（哪些功能開著）、ui.keys_on（快捷鍵總開關）、keys（改過的鍵位）。
   瀏覽器 localStorage 裡留一份快取，開啟頁面時先用快取，服務端的到了再以服務端為準。 */
(function (PR) {
  "use strict";

  /* 閱讀頁排版的預設值（Aa 面板和設定 → 閱讀共用；主題單獨存） */
  PR.TYPE_DEFAULTS = { fs: 21, measure: 35, lh: 1.9, font: "serif", mode: "zh", margin: true };

  /* [id, 名字, 預設開關, 說明] */
  PR.FEATURES = [
    ["chat", "問 AI", true, "閱讀頁右側邊讀邊問；段落操作條、選中文字、筆記卡片上的“問 AI”"],
    ["edit", "改譯文", true, "段落操作條裡的“改譯文”（也可以雙擊段落）"],
    ["en", "展開英文原文", true, "段落操作條裡的“原文”"],
    ["pages", "原頁面板", true, "右上角“原頁”，對照 PDF 原頁"],
    ["retranslate", "讓模型重譯一段", false, "會花 token，容易誤點，預設關；開了之後在段落的“⋯”選單裡"],
  ];
  /* [id, 名字, 預設鍵, 分組, 依賴的功能] */
  PR.KEY_ACTIONS = [
    ["next", "下一段", "j", "閱讀"], ["prev", "上一段", "k", "閱讀"],
    ["mode", "譯文 / 對照原文", "b", "閱讀"], ["toc", "目錄", "t", "閱讀"],
    ["fontUp", "字號變大", "=", "閱讀"], ["fontDown", "字號變小", "-", "閱讀"], ["fontReset", "恢復預設字號", "0", "閱讀"],
    ["notes", "筆記面板", "m", "面板"], ["chat", "問 AI（帶當前段）", "a", "面板", "chat"],
    ["pages", "原頁面板", "o", "面板", "pages"], ["pagePrev", "原頁上一頁", "[", "面板", "pages"], ["pageNext", "原頁下一頁", "]", "面板", "pages"],
    ["note", "給當前段寫筆記", "n", "當前段"], ["question", "給當前段提問", "q", "當前段"],
    ["en", "展開這段英文", "y", "當前段", "en"], ["edit", "改譯文", "e", "當前段", "edit"],
    ["redo", "讓模型重譯這段", "", "當前段", "retranslate"],
    ["page", "看這段的原頁", "p", "當前段", "pages"], ["copy", "複製這段譯文", "c", "當前段"],
  ];
  const DEF_KEYS = Object.fromEntries(PR.KEY_ACTIONS.map(([id, , k]) => [id, k]));
  const DEF_FEATURES = Object.fromEntries(PR.FEATURES.map(([id, , on]) => [id, on]));

  const ui = PR.ls.get("easyread-ui", {});
  PR.features = Object.assign({}, DEF_FEATURES, ui.features || {});
  PR.keysOn = ui.keys_on !== false;
  PR.keymap = Object.assign({}, DEF_KEYS, PR.ls.get("easyread-keys", {}));

  PR.feature = (id) => PR.features[id] !== false;
  const show = (k) => (!k ? "" : k === " " ? "空格" : k.length === 1 ? k.toUpperCase() : k);
  PR.keyName = show;
  PR.keyOf = (id) => (PR.keysOn ? show(PR.keymap[id]) : "");
  PR.keyAction = function (k) {
    if (!PR.keysOn) return null;
    if (k === "+") k = "=";
    if (k === "_") k = "-";
    const a = PR.KEY_ACTIONS.find(([id, , , , need]) => PR.keymap[id] === k && (!need || PR.feature(need)));
    return a ? a[0] : null;
  };

  /* 設定頁儲存時呼叫：{features, keys_on, keys} */
  PR.applyUi = function (next, persist) {
    if (next.features) PR.features = Object.assign({}, DEF_FEATURES, next.features);
    if (next.keys_on != null) PR.keysOn = !!next.keys_on;
    if (next.keys) PR.keymap = Object.assign({}, DEF_KEYS, next.keys);
    const diff = Object.fromEntries(Object.entries(PR.keymap).filter(([id, k]) => DEF_KEYS[id] !== k));
    PR.ls.set("easyread-ui", { features: PR.features, keys_on: PR.keysOn });
    PR.ls.set("easyread-keys", diff);
    if (persist) {
      PR.savePrefs("ui", { features: PR.features, keys_on: PR.keysOn });
      PR.savePrefs("keys", Object.assign(Object.fromEntries(Object.keys(DEF_KEYS).map((id) => [id, null])), diff));
    }
    PR.emit && PR.emit("ui-changed");
  };
  PR.defaultKeys = () => Object.assign({}, DEF_KEYS);

  /* 服務端 prefs 到了之後以它為準 */
  PR.useServerUi = function (p) {
    const keys = p.keys ? Object.fromEntries(Object.entries(p.keys).filter(([, v]) => v !== null)) : null;
    PR.applyUi({ features: (p.ui || {}).features || PR.features, keys_on: (p.ui || {}).keys_on, keys: keys ? Object.assign({}, DEF_KEYS, keys) : PR.keymap }, false);
  };
})(window.PR);
