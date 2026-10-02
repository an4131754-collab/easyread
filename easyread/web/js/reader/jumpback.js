/* 跳轉後能回去：點引用 [n]、“公式 (4)”、目錄、筆記卡片這類跳到遠處時，記下原來的位置，
   左下角出現“返回剛才讀的地方”；瀏覽器的後退（Alt+←、滑鼠側鍵、手機返回手勢）也能回去。跳了幾次就能回幾次。 */
(function (PR) {
  "use strict";
  const stack = [];
  let btn = null;
  let hit = null;  // 剛才點的是哪一段（點了這段裡的 [n]、“公式 (4)”），回來時高亮的就是它
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest && e.target.closest('#paper [id^="b-"]');
    hit = b ? { el: b, t: Date.now() } : null;
  }, true);

  /* 在跳轉前呼叫：目標就在眼前（一屏以內）就不記 */
  PR.rememberSpot = function (target) {
    const r = target.getBoundingClientRect();
    if (r.top > -innerHeight * 0.5 && r.bottom < innerHeight * 1.5) return;
    const from = hit && Date.now() - hit.t < 3000 && hit.el.isConnected ? hit.el : null;  // 從目錄、筆記卡片跳的就沒有
    hit = null;
    const id = from ? from.id.slice(2) : PR.readingBlock();
    const el = document.getElementById("b-" + id) || document.getElementById("b-head");
    stack.push({ id, off: el ? el.getBoundingClientRect().top : 0, y: scrollY, exact: !!from });
    if (stack.length > 30) stack.shift();
    try { history.pushState({ easyreadBack: stack.length }, "", location.href); } catch (e) { /* file:// 下可能不讓改歷史 */ }
    show();
  };

  function label() {
    const s = stack[stack.length - 1];
    const sec = s && PR.blockById[s.id] && PR.sectionOf ? PR.sectionOf(s.id) : "";
    return "返回剛才讀的地方" + (sec ? "：" + sec : "");
  }
  function show() {
    if (!btn) {
      btn = PR.el("button", { class: "jump-back", type: "button", title: "回到跳轉前的位置（瀏覽器後退也可以）" });
      btn.onclick = () => (history.state && history.state.easyreadBack ? history.back() : goBack());
      document.body.appendChild(btn);
    }
    btn.innerHTML = PR.icon("back", "sm") + "<span>" + PR.esc(label()) + "</span>" + (stack.length > 1 ? "<em>" + stack.length + "</em>" : "");
    btn.hidden = false;
  }
  function goBack() {
    const s = stack.pop();
    if (!s) return;
    const el = document.getElementById("b-" + s.id);
    if (el && s.exact) {  // 知道是從哪段跳走的：把那段放回螢幕中間並高亮
      PR.centerOn(el);
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    } else if (el) window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - s.off, behavior: "smooth" });  // 不知道：回到原來的位置，不亂高亮
    else window.scrollTo({ top: s.y, behavior: "smooth" });
    if (stack.length) show(); else btn.hidden = true;
  }
  window.addEventListener("popstate", () => { if (stack.length) goBack(); });

  /* 自己滾回原處了，按鈕就收起來 */
  window.addEventListener("scroll", PR.debounce(() => {
    const s = stack[stack.length - 1];
    if (!s || !btn || btn.hidden) return;
    const el = document.getElementById("b-" + s.id);
    if (el && Math.abs(el.getBoundingClientRect().top - s.off) < innerHeight * 0.4) { stack.pop(); if (stack.length) show(); else btn.hidden = true; }
  }, 300), { passive: true });
})(window.PR);
