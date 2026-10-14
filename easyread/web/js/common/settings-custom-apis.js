/* Named custom connections; credentials stay in the existing server-side key store. */
(function (PR) {
  "use strict";
  const url = (value) => String(value || "").trim().replace(/\/+$/, "");
  function nextName(list) {
    let n = 1;
    while (list.some((p) => p.name === "自訂 API " + n)) n++;
    return "自訂 API " + n;
  }
  function list(s) {
    const out = (s.cfg.openai.custom_apis || []).map((p) => ({ ...p }));
    // Existing custom model cards become reusable connections without re-entering keys.
    for (const m of (s.chat || {}).models || []) {
      if (m.engine !== "openai" || m.preset || !m.base_url || out.some((p) => url(p.base_url) === url(m.base_url))) continue;
      out.push({ name: nextName(out), base_url: url(m.base_url), api: m.api || "chat" });
    }
    return out;
  }
  function find(s, base) { return list(s).find((p) => url(p.base_url) === url(base)); }
  function save(s, a, kp) {
    const base = url(a.base_url);
    if (!/^https?:\/\//i.test(base)) { PR.toast("請填有效的 HTTP 或 HTTPS 接口地址"); return false; }
    const profiles = list(s), old = profiles.find((p) => url(p.base_url) === base);
    const profile = { name: String(a.connection_name || "").trim().slice(0, 80) || (old && old.name) || nextName(profiles), base_url: base, api: a.api || "chat" };
    if (old) Object.assign(old, profile); else profiles.push(profile);
    s.cfg.openai.custom_apis = profiles;
    a.connection_name = profile.name;
    if (a[kp] && !a[kp].startsWith("••••")) (s.chatKeys = s.chatKeys || {})[PR.apiKeyId("", base)] = a[kp];
    for (const m of s.chat.models) if (m.engine === "openai" && !m.preset && url(m.base_url) === base) m.source = profile.name;
    return true;
  }
  function html(s, a) {
    const profiles = list(s);
    return '<div class="custom-connections"><label class="field"><span>' + "已儲存的自訂接口" + '</span><select class="input" data-custom-connection><option value="">' + "新增自訂接口" + '</option>' + profiles.map((p, i) => '<option value="' + i + '"' + (url(a.base_url) === url(p.base_url) ? ' selected' : '') + '>' + PR.esc(p.name + " · " + p.base_url) + '</option>').join("") + '</select></label><label class="field"><span>' + "接口名稱" + '</span><input class="input" data-af="connection_name" value="' + PR.esc(a.connection_name || (find(s, a.base_url) || {}).name || "") + '" placeholder="' + PR.esc(nextName(profiles)) + '"></label></div>';
  }
  function select(s, a, index, kp) {
    const p = index === "" ? null : list(s)[Number(index)];
    Object.assign(a, { preset: "", base_url: p ? p.base_url : "", api: p ? p.api : "chat", connection_name: p ? p.name : "", model: "", [kp]: "" });
    if (p && PR.apiHasKey(s, "", p.base_url)) a[kp] = "••••";
    s.fetchMsg = null; s.apiTyping = false;
  }
  PR.customApis = { list, find, save, html, select };
})(window.PR);
