/* 頁面內的確認框和輸入框，代替瀏覽器自帶的 confirm() / prompt()（那種灰框太醜，也不跟主題）。
   PR.confirm({title, body, ok, danger, at}) → Promise<boolean>
   PR.promptText({title, value, placeholder, ok, at}) → Promise<string|null>
   at：貼著哪個元素或哪個點彈出；不給就用剛才選單彈出的位置，再沒有就放在螢幕中間。
   Enter 確定，Esc 或點外面取消。 */
(function (PR) {
  "use strict";
  let cur = null;

  function close(v) {
    if (!cur) return;
    const { box, done, onKey, onDown } = cur;
    cur = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    box.classList.remove("open");
    setTimeout(() => box.remove(), 150);
    done(v);
  }

  function place(box, at) {
    const r = at && at.getBoundingClientRect ? at.getBoundingClientRect() : at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : null;
    const w = box.offsetWidth, h = box.offsetHeight;
    if (!r) { box.style.left = Math.max(8, (innerWidth - w) / 2) + "px"; box.style.top = Math.max(8, innerHeight * 0.28) + "px"; return; }
    let y = r.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px";
    box.style.top = y + "px";
  }

  function open(o, withInput) {
    close(withInput ? null : false);
    return new Promise((done) => {
      const box = PR.el("div", { class: "popover confirm", role: "dialog" },
        '<div class="cf-title">' + PR.esc(o.title || "") + "</div>" +
        (o.body ? '<div class="cf-body">' + PR.esc(o.body) + "</div>" : "") +
        (withInput ? '<input class="input cf-input" maxlength="' + (o.max || 60) + '" placeholder="' + PR.esc(o.placeholder || "") + '">' : "") +
        '<div class="cf-acts"><button class="btn sm" data-cf="no">取消</button><button class="btn sm ' + (o.danger ? "danger-fill" : "accent") + '" data-cf="ok">' + PR.esc(o.ok || "確定") + "</button></div>");
      document.body.appendChild(box);
      const inp = box.querySelector(".cf-input");
      if (inp) inp.value = o.value || "";
      place(box, o.at || PR.lastMenuAt);
      requestAnimationFrame(() => box.classList.add("open"));
      const result = (ok) => (withInput ? (ok ? inp.value.trim() || null : null) : ok);
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(result(false)); }
        else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); close(result(true)); }
      };
      const onDown = (e) => { if (!box.contains(e.target)) close(result(false)); };
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-cf]"); if (b) close(result(b.dataset.cf === "ok")); });
      cur = { box, done, onKey, onDown };
      document.addEventListener("keydown", onKey, true);
      setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
      (inp || box.querySelector('[data-cf="ok"]')).focus();
      if (inp) inp.select();
    });
  }

  PR.confirm = (o) => open(o, false);
  PR.promptText = (o) => open(o, true);
})(window.PR);
