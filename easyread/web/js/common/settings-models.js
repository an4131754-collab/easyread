/* Claude Code / Codex 的模型下拉框，“翻譯”和“問 AI”兩頁共用（API 的表單在 settings-api.js）。
   名單來自 /api/engines 的 models（後端 cli_models.py）：Codex 就是它 /model 裡列的那些；Claude 的別名帶上實際版本。 */
(function (PR) {
  "use strict";
  const FALLBACK = { claude: { models: [{ id: "opus", name: "Opus", desc: "最強" }, { id: "sonnet", name: "Sonnet", desc: "快、省" }, { id: "haiku", name: "Haiku", desc: "最快最省" }] },
    codex: { default: "", models: [] } };
  const lists = (s) => (s.models || FALLBACK);

  /* 下拉框的選項：[[value, label]]，選項就寫模型名。Codex 一個模型都沒查到時才留一項“Codex 預設” */
  PR.cliModelOptions = function (s, engine, value) {
    const L = lists(s)[engine] || FALLBACK[engine];
    let opts;
    if (engine === "claude") {
      opts = L.models.map((m) => [m.id, m.actual || "Claude " + m.name]);
    } else {
      opts = L.models.map((m) => [m.id, m.name]);
      if (!opts.length) opts.unshift(["", "Codex 預設"]);
    }
    if (value && !opts.some(([v]) => v === value)) opts.push([value, value]);
    return opts;
  };
  PR.cliModelSelect = (s, engine, value, attrs) =>
    "<select class=\"input\" " + attrs + ">" + PR.opt(PR.cliModelOptions(s, engine, value), value) + "</select>";
  /* 以前存的“跟隨 CLI 預設”（模型空著）→ 換成它現在實際用的那個，翻譯固定用一個模型，不隨 CLI 設定變 */
  PR.cliPin = function (s, engine, model) {
    if (model || (engine !== "claude" && engine !== "codex") || !s.models) return model;
    const L = s.models[engine] || {};
    if (engine === "codex") return L.default || "";
    const hit = (L.models || []).find((m) => m.actual && m.actual === L.default);
    return hit ? hit.id : "opus";
  };

})(window.PR);
