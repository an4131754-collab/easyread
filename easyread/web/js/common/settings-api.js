/* API 介面的表單，設定 → 模型頁裡新增、修改模型時用：
   服務商（按 國內直連 / 海外 / 本機 分組，有免費模型的帶“免費”）→ 說明和獲取 Key → API Key → 模型 → 高階（介面地址、介面格式）。
   自定義地址時，介面地址和格式直接放在最上面。
   表單的值放在呼叫方給的物件 a 裡：{preset, base_url, api, model, vision, [keyProp]}；
   翻譯設定用 keyProp api_key（存過的顯示成 ••••），模型卡片的表單用 key。 */
(function (PR) {
  "use strict";
  const API_KINDS = [["chat", "Chat Completions（通用）"], ["responses", "Responses（OpenAI 新介面）"]];
  const found = {};  // 介面地址 → 點“獲取模型列表”拉到的模型名
  const masked = (v) => String(v || "").startsWith("••••");
  const preset = (s, id) => s.presets.find((p) => p.id === id);
  const hasKey = (s, id) => (s.cfg.openai.saved_keys || []).includes(id) || !!(s.chatKeys || {})[id];
  PR.apiHasKey = hasKey;
  /* 模型的顯示名：推薦名單裡有就用“DeepSeek V4.1 Flash”，沒有就是模型名本身 */
  PR.apiModelName = (s, presetId, model) => ((((preset(s, presetId) || {}).models) || []).find((m) => m.id === model) || {}).name || model;

  function tiles(s, a) {
    const tile = (p) => '<button data-af-preset="' + p.id + '" class="' + (a.preset === p.id ? "on" : "") + '">' + PR.esc(p.name) +
      (p.free ? '<i class="free-tag">免費</i>' : "") + (hasKey(s, p.id) ? ' <span class="ok-dot" title="已存 Key"></span>' : "") + "</button>";
    return '<div class="preset-tiles grouped">' + s.groups.map(([g, label]) => {
      const ps = s.presets.filter((p) => p.region === g);
      return ps.length ? '<div class="preset-group"><span>' + PR.esc(label) + "</span>" + ps.map(tile).join("") + "</div>" : "";
    }).join("") + '<div class="preset-group"><span>其他</span><button data-af-preset="" class="' + (!a.preset ? "on" : "") + '">自定義地址</button>' +
      '<em class="hint">任意 OpenAI 相容介面、中轉站</em></div></div>';
  }

  /* 模型：推薦的 + 接口裡拉到的，做成下拉框，最後一項“手填”；都沒有（自定義、LM Studio）或選了手填時是輸入框 */
  function modelField(s, a, p) {
    const rec = (p && p.models) || [];
    let got = found[(a.base_url || "").trim()] || [];
    if (!got.length && a.preset === "ollama" && s.found && s.found.ollama) got = s.found.ollama.models;
    if (s.apiTyping || (!rec.length && !got.length)) {
      return '<input class="input" data-af="model" value="' + PR.esc(a.model) + '" placeholder="模型名，比如 deepseek-flash">';
    }
    const recIds = rec.map((m) => m.id);
    let h = PR.opt(rec.map((m) => [m.id, m.name + (m.tag ? " · " + m.tag : "")]), a.model);
    const rest = got.filter((m) => !recIds.includes(m));
    if (rest.length) h += '<optgroup label="' + (a.preset === "ollama" && !found[(a.base_url || "").trim()] ? "本機已下載" : "接口裡的全部模型") + '">' + PR.opt(rest.map((m) => [m, m]), a.model) + "</optgroup>";
    if (a.model && !recIds.includes(a.model) && !got.includes(a.model)) h = PR.opt([[a.model, a.model]], a.model) + h;
    if (!a.model) h = '<option value="" selected>選一個模型</option>' + h;
    return '<select class="input" data-af="model">' + h + '<option value="__type">手填模型名…</option></select>';
  }

  function html(s, a, opt) {
    const p = preset(s, a.preset);
    const kp = opt.keyProp, saved = hasKey(s, a.preset) || masked(a[kp]);
    const addr = '<div class="grid2"><label class="field"><span>介面地址（base URL）</span><input class="input" data-af="base_url" value="' + PR.esc(a.base_url) + '" placeholder="https://…/v1"></label>' +
      '<label class="field"><span>介面格式</span><select class="input" data-af="api">' + PR.opt(API_KINDS, a.api || "chat") + "</select></label></div>";
    let note = p ? PR.esc(p.note || "") : "填服務商給的介面地址（一般以 /v1 結尾）。不知道選哪種介面格式就用 Chat Completions；只支援 Responses 的才換。";
    if (a.preset === "ollama" && s.found) {
      const ol = s.found.ollama;
      note = (ol && ol.running ? "Ollama 在執行，已下載 " + ol.models.length + " 個模型。" : '<span class="bad">沒檢測到 Ollama（127.0.0.1:11434）。</span>') + note;
    }
    const link = p && p.key_url ? ' <a href="' + p.key_url + '" target="_blank" rel="noopener">' + (p.key ? "獲取 Key ↗" : "下載 ↗") + "</a>" : "";
    const fetchMsg = s.fetchMsg || {};
    return tiles(s, a) + '<p class="hint preset-note">' + note + link + "</p>" + (p ? "" : addr) +
      (p && !p.key ? "" : '<label class="field"><span>API Key</span><input class="input" type="password" data-af="key" value="' + (masked(a[kp]) ? "" : PR.esc(a[kp] || "")) +
        '" placeholder="' + (saved ? "已儲存，留空不改" : "sk-…") + '" autocomplete="off"></label>') +
      '<label class="field"><span>模型</span><div class="model-row">' + modelField(s, a, p) +
      '<button class="btn sm line" data-fetch-models title="從介面讀出它支援的全部模型">獲取模型列表</button></div>' +
      (fetchMsg.text ? '<span class="test-result ' + (fetchMsg.cls || "") + '">' + PR.esc(fetchMsg.text) + "</span>" : "") + "</label>" +
      (opt.vision ? '<label class="check" style="margin:0 0 10px"><input type="checkbox" data-af="vision"' + (a.vision ? " checked" : "") + ">模型能看圖（把原頁圖一起發過去，公式和表格更準）</label>" : "") +
      (p ? '<details class="api-adv"' + (s.advOpen ? " open" : "") + "><summary>高階：介面地址、介面格式</summary>" + addr + "</details>" : "");
  }

  function read(root, a, kp) {
    PR.$$("[data-af]", root).forEach((el) => {
      const k = el.dataset.af, v = el.type === "checkbox" ? el.checked : el.value.trim();
      if (k === "key") { if (v) a[kp] = v; }
      else if (!(k === "model" && v === "__type")) a[k] = v;
    });
    const adv = PR.$(".api-adv", root);
    PR.settingsState.advOpen = !!(adv && adv.open);
  }

  /* 換服務商：地址、格式、預設模型跟著換；換到自定義時清空讓使用者填 */
  function pick(s, a, id, kp) {
    const p = preset(s, id), prev = a.preset;
    a.preset = id;
    s.fetchMsg = null; s.apiTyping = false;
    if (p) {
      const om = id === "ollama" && s.found && s.found.ollama && s.found.ollama.models;
      Object.assign(a, { base_url: p.base_url, api: p.api || "chat", model: om && om.length && !om.includes(p.model) ? om[0] : p.model });
      const m = p.models.find((x) => x.id === a.model);
      a.vision = !!(m && m.vision);
    } else if (prev) Object.assign(a, { base_url: "", api: "chat", model: "", vision: false });
    a[kp] = hasKey(s, id) ? "••••" : "";
  }

  PR.apiForm = {
    html, read,
    pick(s, a, id, kp) { pick(s, a, id, kp); },
    /* 點選：服務商、獲取模型列表。處理了返回 true（要重畫），沒處理返回 false */
    async click(e, s, a, kp, root) {
      const b = e.target.closest("[data-af-preset]");
      if (b) { read(root, a, kp); pick(s, a, b.dataset.afPreset, kp); return true; }
      if (e.target.closest("[data-fetch-models]")) {
        e.preventDefault();
        read(root, a, kp);
        const key = masked(a[kp]) ? (s.chatKeys || {})[a.preset] || "" : a[kp] || "";
        s.fetchMsg = { text: "正在獲取…" };
        PR.settingsRender();
        try {
          const r = await PR.api("/api/models/list", { method: "POST", body: { base_url: a.base_url, preset: a.preset, api_key: key } });
          if (r.ok && r.models.length) { found[(a.base_url || "").trim()] = r.models; s.apiTyping = false; s.fetchMsg = { cls: "ok", text: "✓ 接口裡有 " + r.models.length + " 個模型，都放進下拉框了" }; }
          else s.fetchMsg = { cls: "bad", text: r.ok ? "介面沒返回模型，手填模型名" : "✗ " + r.message };
        } catch (err) { s.fetchMsg = { cls: "bad", text: err.message }; }
        return true;
      }
      return false;
    },
    /* 改動：下拉框選“手填”換成輸入框；換了推薦模型，“能看圖”跟著它勾上或去掉 */
    change(e, s, a, kp, root) {
      if (e.target.dataset.af !== "model") return false;
      if (e.target.value === "__type") { e.target.value = a.model; read(root, a, kp); s.apiTyping = true; return true; }
      read(root, a, kp);
      const m = (((preset(s, a.preset) || {}).models) || []).find((x) => x.id === a.model);
      if (m) a.vision = !!m.vision;
      return true;
    },
  };
})(window.PR);
