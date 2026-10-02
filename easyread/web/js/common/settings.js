/* 設定對話方塊（文獻庫頁和閱讀頁共用）：外殼、分頁、儲存。
   頁：模型（翻譯和問 AI 合在一起，settings-chat.js）、閱讀 / 側邊欄 / 快捷鍵（settings-tabs.js 等）。
   本檔案裡的 engine 不再單獨成頁，只留它的 collect：存的時候從 cfg 取翻譯設定。
   PR.openSettings("keys") 直接開啟某一頁；不指定就從“模型”頁開始（不記上次停在哪頁）。 */
(function (PR) {
  "use strict";
  const dlg = () => PR.$("#settingsDlg");
  const ALL_TABS = [["chat", "模型"], ["reading", "閱讀"], ["library", "側邊欄"], ["keys", "快捷鍵"]];
  const tabs = () => ALL_TABS.filter(([k]) => PR.settingsTabs[k]);  // “側邊欄”頁只在文獻庫頁面有
  PR.settingsTabs = PR.settingsTabs || {};
  const st = (PR.settingsState = { tab: "chat", cfg: null, presets: [], groups: [], found: null, chat: null, ui: null });

  PR.opt = (list, val) => list.map(([v, l]) => '<option value="' + PR.esc(v) + '"' + (String(v) === String(val) ? " selected" : "") + ">" + PR.esc(l) + "</option>").join("");

  PR.openSettings = async function (tab) {
    const [d, chat] = await Promise.all([PR.api("/api/config"), PR.api("/api/chat/models").catch(() => null)]);
    Object.assign(st, { tab: typeof tab === "string" && tab !== "engine" ? tab : "chat", cfg: d.config, presets: d.presets, groups: d.groups || [], chat,
      fetchMsg: null, apiTyping: false, advOpen: false, ui: { features: Object.assign({}, PR.features), keys_on: PR.keysOn, keys: Object.assign({}, PR.keymap) },
      theme: PR.ls.get("easyread-prefs", {}).theme || "auto", recording: null, editing: null, form: null, chatKeys: null, type: null, transChecked: false });
    render();
    dlg().classList.add("open");
    // 每次開啟都問一次（後端有快取，很快）：剛裝好或更新了 Claude Code / Codex，版本號和模型名單馬上跟上
    const r = await PR.api("/api/engines").catch(() => null);
    if (r && (JSON.stringify([r.found, r.models]) !== JSON.stringify([st.found, st.models]))) {
      st.found = r.found; st.models = r.models;
      if (dlg().classList.contains("open")) { sync(); render(); }
    }
  };
  const btn = PR.$("#settingsBtn");
  if (btn) btn.onclick = () => PR.openSettings();

  function sync() { const t = PR.settingsTabs[st.tab]; if (t && t.sync) t.sync(st, dlg()); }
  PR.settingsRender = render;
  function render() {
    const t = PR.settingsTabs[st.tab];
    dlg().querySelector(".dialog").innerHTML =
      '<div class="set-head"><h2>設定</h2><div class="set-tabs">' + tabs().map(([k, l]) => '<button data-set-tab="' + k + '" class="' + (st.tab === k ? "on" : "") + '">' + l + "</button>").join("") + "</div></div>" +
      '<div class="set-body">' + (t ? t.render(st) : "") + "</div>" +
      '<div class="actions set-foot"><button class="linkish" id="showLog">執行日誌</button><span class="grow"></span><button class="btn" id="setCancel">取消</button><button class="btn primary" id="setSave">儲存</button></div>';
  }

  async function save() {
    sync();
    const r = await PR.api("/api/config", { method: "POST", body: PR.settingsTabs.engine.collect(st) });
    st.cfg = r.config;
    if (st.chat) st.chat = await PR.api("/api/chat/models", { method: "POST", body: { models: st.chat.models, default: st.chat.default, keys: st.chatKeys || {} } });
    PR.applyUi(st.ui, true);
    PR.ls.set("easyread-auto-translate", !!st.cfg.auto_translate);
    const prefs = PR.ls.get("easyread-prefs", {});
    if (prefs.theme !== st.theme) { prefs.theme = st.theme; PR.ls.set("easyread-prefs", prefs); PR.savePrefs("reader", { theme: st.theme }); if (PR.prefs) PR.prefs.theme = st.theme; }
    PR.applyTheme(st.theme);
    if (st.type) {  // 排版：閱讀頁裡立刻生效；文獻庫頁只存起來
      PR.ls.set("easyread-prefs", Object.assign(PR.ls.get("easyread-prefs", {}), st.type));
      if (PR.resetAllType) PR.resetAllType(st.type); else PR.savePrefs("reader", st.type);
    }
    dlg().classList.remove("open");
    PR.toast("設定已儲存");
    PR.onSettingsSaved && PR.onSettingsSaved();
    PR.emit("settings-saved", st);
  }

  PR.showText = function (title, text) {
    const d = PR.$("#textDlg");
    d.querySelector(".dialog").innerHTML = "<h2>" + PR.esc(title) + '</h2><pre class="logview">' + PR.esc(text || "（還沒有記錄）") + '</pre><div class="actions"><button class="btn" data-close>關閉</button></div>';
    d.classList.add("open");
    const pre = d.querySelector("pre"); pre.scrollTop = pre.scrollHeight;
  };
  const td = PR.$("#textDlg");
  if (td) td.addEventListener("click", (e) => { if (e.target.id === "textDlg" || e.target.closest("[data-close]")) td.classList.remove("open"); });

  dlg().addEventListener("click", async (e) => {
    if (e.target === dlg() || e.target.closest("#setCancel")) { st.recording = null; return dlg().classList.remove("open"); }
    const tb = e.target.closest("[data-set-tab]");
    if (tb) { sync(); st.tab = tb.dataset.setTab; st.recording = null; st.editing = null; render(); return; }
    if (e.target.closest("#showLog")) { const r = await PR.api("/api/log"); PR.showText("執行日誌", r.text + "\n\n（完整日誌：" + r.path + "）"); return; }
    if (e.target.closest("#setSave")) { try { await save(); } catch (err) { PR.toast("儲存失敗：" + PR.esc(err.message)); } return; }
    const t = PR.settingsTabs[st.tab];
    if (t && t.click && (await t.click(e, st, dlg()))) render();
  });
  dlg().addEventListener("change", (e) => {
    const t = PR.settingsTabs[st.tab];
    if (t && t.change && t.change(e, st, dlg())) render();
  });
  document.addEventListener("keydown", (e) => {
    if (!dlg().classList.contains("open")) return;
    const t = PR.settingsTabs[st.tab];
    if (st.recording && t && t.key) { e.preventDefault(); e.stopImmediatePropagation(); if (t.key(e, st)) render(); return; }
    if (e.key === "Escape") dlg().classList.remove("open");
  }, true);

  /* ---------- 翻譯設定：存的時候從 cfg 取（頁面在 settings-chat.js，改動隨時寫回 cfg） ---------- */
  PR.settingsTabs.engine = {
    collect(state) {
      const c = state.cfg, o = c.openai;
      return { engine: c.engine, batch_pages: c.batch_pages, concurrency: c.concurrency, auto_translate: c.auto_translate,
        claude: { model: c.claude.model, command: c.claude.command }, codex: { model: c.codex.model, command: c.codex.command },
        openai: { preset: o.preset, base_url: o.base_url, api: o.api, model: o.model, api_key: o.api_key, vision: o.vision } };
    },
  };
})(window.PR);
