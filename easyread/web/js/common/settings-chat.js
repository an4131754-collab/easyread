/* 設定 → 模型：翻譯和“問 AI”合在一頁。
   上面一排卡片是你能用的模型（Claude Code / Codex / 各家 API），每張卡片可以標“翻譯”和“問 AI 預設”；
   點卡片彈出選單：設為翻譯、設為問 AI、改 Key 和地址（只有 API 卡片）、刪除；拖動卡片排序。新增時下面出現來源卡片和模型選擇，API 的表單見 settings-api.js。
   下面是翻譯自己的設定（每次幾頁、同時幾批、匯入後自動翻譯、試譯一句）。
   存的時候：翻譯用的那張卡片寫進 config 的 engine / claude / codex / openai（背景翻譯讀這些），整份名單寫進 chat.models。
   API 的 Key 每家只存一份，翻譯和問 AI 共用。 */
(function (PR) {
  "use strict";
  const T = PR.settingsTabs;
  const kindOf = (m) => (m.engine === "openai" ? "api" : m.engine);
  const isApi = (k) => k === "api";
  const root = () => PR.$("#settingsDlg");
  const preset = (s, id) => s.presets.find((x) => x.id === id);

  /* ---------- 翻譯用的是哪張卡片 ---------- */
  function sameAsTranslation(s, m) {
    const c = s.cfg, e = c.engine;
    if (m.engine !== e) return false;
    if (e === "claude" || e === "codex") return (m.model || "") === (c[e].model || "");
    const o = c.openai, p = preset(s, m.preset);
    return (m.preset || "") === (o.preset || "") && (m.model || "") === (o.model || "") &&
      (m.base_url || (p ? p.base_url : "")) === (o.base_url || "");
  }
  const transIndex = (s) => s.chat.models.findIndex((m) => sameAsTranslation(s, m));

  /* 以前的“跟隨預設”卡片（模型空著）釘到具體模型；釘完和別的卡片一樣的就合成一張 */
  function pinDefaults(s) {
    if (s.pinned || !s.models || !s.chat) return;
    s.pinned = true;
    const c = s.cfg;
    if (c.engine === "claude" || c.engine === "codex") c[c.engine].model = PR.cliPin(s, c.engine, c[c.engine].model);
    const list = s.chat.models, seen = {};
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.engine === "claude" || m.engine === "codex") {
        const was = m.model || "";
        m.model = PR.cliPin(s, m.engine, was);
        if (!was && m.model) { const n = autoName(s, { kind: m.engine, model: m.model }); m.name = m.label = n; m.detail = m.model; }
      }
      const key = [m.engine, m.model, m.preset || "", m.base_url || ""].join("|");
      if (seen[key]) {
        if (s.chat.default === m.id) s.chat.default = seen[key].id;
        list.splice(i--, 1);
      } else seen[key] = m;
    }
  }

  /* 翻譯現在用的模型不在名單裡（以前分兩頁設的）：給它補一張卡片 */
  function ensureTranslationCard(s) {
    if (s.transChecked || !s.chat) return;
    s.transChecked = true;
    if (s.cfg.engine === "none") { s.cfg.engine = "claude"; s.cfg.auto_translate = false; }  // 舊的“不翻譯”= 關掉自動翻譯
    if (transIndex(s) >= 0) return;
    const c = s.cfg, e = c.engine, o = c.openai, p = preset(s, o.preset);
    const f = e === "openai" ? { kind: "api", preset: o.preset || "", model: o.model || "", base_url: o.base_url || "", api: o.api || "chat" }
      : { kind: e, model: c[e].model || "" };
    s.chat.models.unshift(Object.assign(toModel(s, f, p), { id: "m" + Date.now().toString(36) }));
  }

  /* 把一張卡片設成翻譯用：寫進 cfg 的 engine 和對應那一節 */
  function useForTranslation(s, m) {
    const c = s.cfg;
    if (m.engine === "openai") {
      const p = preset(s, m.preset), typed = (s.chatKeys || {})[m.preset];
      const rec = ((p && p.models) || []).find((x) => x.id === m.model);
      Object.assign(c.openai, { preset: m.preset || "", base_url: m.base_url || (p ? p.base_url : ""), api: m.api || (p && p.api) || "chat",
        model: m.model, api_key: typed || (PR.apiHasKey(s, m.preset) ? "••••" : ""), vision: rec ? !!rec.vision : !!c.openai.vision });
      if (c.engine !== "openai" && c.concurrency < 2) c.concurrency = 3;
    } else {
      c[m.engine].model = m.model || "";
      if (c.engine === "openai" && c.concurrency > 2) c.concurrency = 1;
    }
    c.engine = m.engine;
  }

  /* ---------- 卡片 ---------- */
  function cardsHtml(s) {
    const list = s.chat.models, ti = transIndex(s);
    return '<div class="engine-cards mc-cards">' + list.map((m, i) => {
      const def = s.chat.default === m.id, tr = i === ti;
      const tags = (tr ? '<span class="badge ok">翻譯</span>' : "") + (def ? '<span class="badge ok">問 AI 預設</span>' : "");
      const bad = m.ready === false ? '<span class="badge bad" title="' + PR.esc(m.hint || "") + '">' + PR.esc(m.hint || "還不能用") + "</span>" : "";
      return '<div class="mc' + (tr || def ? " on" : "") + (s.editing === m.id ? " editing" : "") + (m.ready === false ? " off" : "") + '" data-cm="more" data-i="' + i + '" draggable="true" role="button" tabindex="0" title="點一下設定，拖動排序">' +
        '<span class="mc-more">' + PR.icon("more", "sm") + "</span>" +
        "<b>" + PR.esc(m.label || m.name) + "</b>" + PR.esc(m.source || "") +
        (tags || bad ? '<span class="mc-tags">' + tags + bad + "</span>" : "") + "</div>";
    }).join("") +
      '<div class="mc add' + (s.editing === "new" ? " editing" : "") + '" data-cm="add" role="button" tabindex="0">' + PR.icon("plus") + "<b>新增模型</b></div></div>";
  }

  /* ---------- 新增 / 修改的表單 ---------- */
  function formHtml(s) {
    const f = s.form;
    const card = (k, title) => '<button data-cmk="' + k + '" class="' + (f.kind === k ? "on" : "") + '"><b>' + title + "</b></button>";
    let h = '<div class="mc-form"><h4 class="set-h">' + (s.editing === "new" ? "新增模型" : "修改") + "</h4>" +
      '<div class="engine-cards small">' + card("claude", "Claude Code") + card("codex", "Codex CLI") + card("api", "API 介面") + "</div>";
    if (f.kind === "claude" || f.kind === "codex") {
      const found = (s.found || {})[f.kind];
      h += '<label class="field"><span>模型</span>' + PR.cliModelSelect(s, f.kind, f.model, 'id="cmModel"') + "</label>" +
        (found && !found.found ? '<p class="hint">本機沒找到 ' + (f.kind === "claude" ? '<a href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noopener">Claude Code</a>' : "Codex CLI") + "</p>" : "");
    } else {
      h += PR.apiForm.html(s, f, { keyProp: "key", vision: false });
    }
    return h + '<div class="cm-form-acts"><span class="grow"></span>' +
      '<button class="btn sm" data-cm="cancel">取消</button><button class="btn sm accent" data-cm="ok">' + (s.editing === "new" ? "新增" : "儲存") + "</button></div></div>";
  }
  function autoName(s, f) {
    if (f.kind === "claude" || f.kind === "codex") {  // 卡片名就是模型名
      const o = PR.cliModelOptions(s, f.kind, f.model).find(([v]) => v === (f.model || ""));
      return o ? o[1] : f.model || (f.kind === "claude" ? "Claude" : "GPT");
    }
    const p = preset(s, f.preset);
    return f.model ? PR.apiModelName(s, f.preset, f.model) : p ? p.name : "模型";
  }
  function toModel(s, f, p) {
    const api = isApi(f.kind), name = autoName(s, f);
    const rec = api && p && (p.models || []).find((x) => x.id === f.model);
    return { engine: api ? "openai" : f.kind, preset: api ? f.preset : "",
      base_url: api && (!p || f.base_url !== p.base_url) ? f.base_url : "", api: api && (!p || f.api !== (p.api || "chat")) ? f.api : "", model: f.model, name, label: name,
      vision: api && (rec ? !!rec.vision : !!f.vision),
      source: api ? (p ? p.name : "自定義地址") : f.kind === "claude" ? "Claude Code" : "Codex CLI",
      detail: f.model, ready: true };
  }
  function readForm(s) {
    const f = s.form;
    if (!f) return;
    const v = (id) => { const el = PR.$("#" + id); return el ? el.value.trim() : null; };
    if (isApi(f.kind)) PR.apiForm.read(root(), f, "key");
    else if (v("cmModel") !== null) f.model = v("cmModel");
  }
  function startForm(s, m) {
    const p = m && preset(s, m.preset);
    s.form = m ? { kind: kindOf(m), model: m.model || "", preset: m.preset || "", base_url: m.base_url || (p ? p.base_url : ""), api: m.api || (p && p.api) || "chat", vision: !!m.vision,
      name: "", key: "" }
      : { kind: "claude", model: "opus", preset: "", base_url: "", api: "", name: "", key: "" };
    s.fetchMsg = null; s.apiTyping = false;
  }

  /* ---------- 翻譯自己的設定 ---------- */
  function translationHtml(s) {
    const c = s.cfg, ti = transIndex(s), m = s.chat.models[ti];
    const e = c.engine;
    let h = '<h4 class="set-h">翻譯' + (m ? "：" + PR.esc(m.label || m.name) : "") + "</h4>";
    if (e === "openai") h += '<label class="check" style="margin:0 0 10px"><input type="checkbox" data-k="openai.vision"' + (c.openai.vision ? " checked" : "") + ">模型能看圖</label>";
    h += '<div class="grid2">' +
      '<label class="field"><span>每批頁數</span><select class="input" data-k="batch_pages">' + PR.opt([[1, "1 頁"], [2, "2 頁"], [3, "3 頁"], [4, "4 頁"]], c.batch_pages) + "</select></label>" +
      '<label class="field"><span>同時幾批</span><select class="input" data-k="concurrency">' + PR.opt([[1, "1"], [2, "2"], [3, "3"], [4, "4"], [6, "6"]], c.concurrency) + "</select></label></div>" +
      '<div class="test-line"><button class="btn sm line" id="testBtn">' + PR.icon("sparkle", "sm") + '試譯一句</button><span class="test-result" id="testRes"></span></div>';
    if (e === "claude" || e === "codex") {
      h += '<details class="api-adv"><summary>高階</summary><label class="field"><span>' + (e === "claude" ? "Claude Code" : "Codex") + ' 命令</span><input class="input" data-k="' + e + '.command" value="' + PR.esc(c[e].command) + '"></label></details>';
    }
    return h;
  }
  /* 頁面上翻譯那幾項的值讀回 cfg（存的時候 settings.js 從 cfg 取） */
  function readTranslation(s) {
    PR.$$("[data-k]", root()).forEach((el) => {
      const [a, b] = el.dataset.k.split(".");
      const v = el.type === "checkbox" ? el.checked : el.value;
      if (b) s.cfg[a][b] = v; else s.cfg[a] = ["batch_pages", "concurrency"].includes(a) ? +v : v;
    });
  }

  T.chat = {
    render(s) {
      if (!s.chat) return '<p class="hint">讀不到模型名單。</p>';
      pinDefaults(s);
      ensureTranslationCard(s);
      return cardsHtml(s) + (s.editing ? formHtml(s) : "") +
        '<div class="settings-sec">' + translationHtml(s) + "</div>" +
        '<p class="hint" style="margin-top:14px">文獻庫位置：' + PR.esc(s.cfg.library_dir) + "</p>";
    },
    sync(s) { readForm(s); readTranslation(s); },
    change(e, s) {
      if (e.target.dataset.k) { readTranslation(s); return false; }
      if (s.form && isApi(s.form.kind)) return PR.apiForm.change(e, s, s.form, "key", root());
      if (e.target.id === "cmModel" && e.target.tagName === "SELECT") { readForm(s); return true; }  // 換了模型，預設名字跟著變
      return false;
    },
    async click(e, s) {
      if (e.target.closest("#testBtn")) {
        readTranslation(s);
        const res = PR.$("#testRes");
        res.className = "test-result"; res.innerHTML = '<span class="spin"></span> 正在讓模型回一句話…';
        try {
          await PR.api("/api/config", { method: "POST", body: T.engine.collect(s) });
          const r = await PR.api("/api/config/test", { method: "POST", body: { engine: s.cfg.engine } });
          res.className = "test-result " + (r.ok ? "ok" : "bad"); res.textContent = (r.ok ? "✓ " : "✗ ") + r.message;
        } catch (err) { res.className = "test-result bad"; res.textContent = err.message; }
        return false;
      }
      const k = e.target.closest("[data-cmk]");
      if (k && s.form) {
        readForm(s);
        const f = s.form, kind = k.dataset.cmk;
        if (kind === f.kind) return false;
        Object.assign(f, { kind, model: kind === "claude" ? "opus" : PR.cliPin(s, kind, ""), name: "", key: "", base_url: "", api: "" });
        s.fetchMsg = null; s.apiTyping = false;
        if (isApi(kind)) {  // 先給一家：翻譯那邊用的 API，沒有就 DeepSeek
          const o = s.cfg.openai;
          PR.apiForm.pick(s, f, s.cfg.engine === "openai" && o.preset ? o.preset : "deepseek", "key");
        }
        return true;
      }
      if (s.form && isApi(s.form.kind) && e.target.closest("[data-af-preset], [data-fetch-models]")) {
        readForm(s);
        return PR.apiForm.click(e, s, s.form, "key", root());
      }
      const b = e.target.closest("[data-cm]");
      if (!b) return false;
      const i = +b.dataset.i, list = s.chat.models, act = b.dataset.cm;
      if (act === "more") {
        const m = list[i], tr = i === transIndex(s);
        readTranslation(s);
        PR.menu(b, [
          { label: "設為翻譯", icon: "sparkle", disabled: tr, fn: () => { useForTranslation(s, m); PR.settingsRender(); } },
          { label: "設為問 AI", icon: "note", disabled: s.chat.default === m.id, fn: () => { s.chat.default = m.id; PR.settingsRender(); } },
          "-",
          // 本機 CLI 的卡片就是一個模型，想換模型刪了再加；API 卡片才有 Key、地址可改
          ...(m.engine === "openai" ? [{ label: "改 Key 和地址", icon: "edit", fn: () => { readForm(s); s.editing = m.id; startForm(s, m); PR.settingsRender(); } }] : []),
          "-",
          { label: "刪除", icon: "trash", disabled: tr, fn: async () => {
            if (list.length <= 1) return PR.toast("至少留一個模型");
            if (!(await PR.confirm({ title: "刪除“" + (m.label || m.name) + "”？", body: "已有的對話不受影響。", ok: "刪除", danger: true }))) return;
            const at = list.indexOf(m); if (at >= 0) list.splice(at, 1);
            if (s.chat.default === m.id) s.chat.default = list[0].id;
            if (s.editing === m.id) { s.editing = null; s.form = null; }
            PR.settingsRender();
          } },
        ]);
        return false;
      }
      if (act === "add") { readForm(s); s.editing = "new"; startForm(s); }
      if (act === "cancel") { s.editing = null; s.form = null; }
      if (act === "ok") {
        readForm(s);
        const f = s.form, api = isApi(f.kind), p = preset(s, f.preset);
        if (api && !p && !f.base_url) { PR.toast("填介面地址"); return false; }
        if (api && !f.model) { PR.toast("填一個模型名"); return false; }
        const typed = f.key && !f.key.startsWith("••••") ? f.key : "";
        if (api && p && p.key && !PR.apiHasKey(s, f.preset) && !typed) { PR.toast("這家要填 API Key"); return false; }
        if (api && typed) (s.chatKeys = s.chatKeys || {})[f.preset] = typed;
        const m = toModel(s, f, p);
        if (s.editing === "new") list.push(Object.assign(m, { id: "m" + Date.now().toString(36) }));
        else {
          const old = list.find((x) => x.id === s.editing), wasTr = sameAsTranslation(s, old);
          Object.assign(old, m);
          if (wasTr) useForTranslation(s, old);  // 改的是翻譯用的那張：翻譯跟著改
        }
        s.editing = null; s.form = null;
      }
      return true;
    },
  };

  /* 拖動卡片排序 */
  let from = -1;
  const cardAt = (e) => e.target.closest && e.target.closest(".mc-cards .mc[data-i]");
  const clear = () => PR.$$(".mc-cards .mc", root()).forEach((c) => c.classList.remove("dragging", "drop-before", "drop-after"));
  root().addEventListener("dragstart", (e) => {
    const c = cardAt(e);
    if (!c) return;
    from = +c.dataset.i;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    c.classList.add("dragging");
  });
  root().addEventListener("dragover", (e) => {
    const c = cardAt(e);
    if (from < 0 || !c) return;
    e.preventDefault();
    const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    PR.$$(".mc-cards .mc", root()).forEach((x) => x.classList.remove("drop-before", "drop-after"));
    if (+c.dataset.i !== from) c.classList.add(after ? "drop-after" : "drop-before");
  });
  root().addEventListener("drop", (e) => {
    const c = cardAt(e), s = PR.settingsState;
    if (from < 0 || !c || !s.chat) return;
    e.preventDefault();
    const r = c.getBoundingClientRect(), list = s.chat.models;
    let to = +c.dataset.i + (e.clientX > r.left + r.width / 2 ? 1 : 0);
    const [m] = list.splice(from, 1);
    if (to > from) to--;
    list.splice(to, 0, m);
    from = -1;
    T.chat.sync(s);
    PR.settingsRender();
  });
  root().addEventListener("dragend", () => { from = -1; clear(); });
})(window.PR);
