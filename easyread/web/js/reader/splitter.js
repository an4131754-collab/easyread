/* 閱讀區與原頁／筆記／問 AI 共用的分隔線。寬度只保留在本次頁面，不寫入偏好。 */
(function (PR) {
  "use strict";
  const body = document.body;
  const grip = PR.$("#sideResize");
  const desktop = matchMedia("(min-width: 1180px)");
  const panels = { pages: "pageview", notes: "notespanel", chat: "chatpanel" };
  const minReader = 480, minPanel = 420;
  let ratio = null, drag = null, frame = 0, pendingWidth = 0;
  const viewport = () => document.documentElement.clientWidth;
  const panelWidth = () => PR.$("#" + (panels[PR.side] || "pageview")).getBoundingClientRect().width;
  const clamp = (w) => Math.max(minPanel, Math.min(viewport() - minReader, w));

  function readingPoint() {
    const id = PR.readingBlock && PR.readingBlock();
    const node = id === "head" ? PR.$(".paper-head") : id && document.getElementById("b-" + id);
    return node ? { node, top: node.getBoundingClientRect().top } : null;
  }
  function keepPlace(point) {
    if (point && point.node.isConnected) {
      const delta = point.node.getBoundingClientRect().top - point.top;
      if (Math.abs(delta) > .5) window.scrollBy({ top: delta, behavior: "instant" });
    }
  }
  function updateValues() {
    if (!PR.side || !desktop.matches) return;
    const w = viewport(), right = panelWidth();
    grip.setAttribute("aria-controls", "stage " + panels[PR.side]);
    grip.setAttribute("aria-valuemin", Math.ceil(minReader / w * 100));
    grip.setAttribute("aria-valuemax", Math.floor((w - minPanel) / w * 100));
    grip.setAttribute("aria-valuenow", Math.round((w - right) / w * 100));
    grip.setAttribute("aria-valuetext", "閱讀區 " + Math.round(w - right) + " 像素，右側面板 " + Math.round(right) + " 像素");
  }
  function setWidth(w, point) {
    const width = clamp(w);
    body.style.setProperty("--side-w", width + "px");
    keepPlace(point);
    updateValues();
  }
  function finishLayout(point) {
    PR.fitWide();
    PR.renderMargin();
    keepPlace(point);
    if (PR.refreshPageSize) PR.refreshPageSize();
  }
  function endDrag() {
    if (!drag) return;
    const last = drag;
    if (frame) { cancelAnimationFrame(frame); frame = 0; setWidth(pendingWidth, last.point); }
    ratio = panelWidth() / viewport();
    drag = null;
    body.classList.remove("side-resizing");
    if (grip.hasPointerCapture(last.pointer)) grip.releasePointerCapture(last.pointer);
    finishLayout(last.point);
  }
  PR.refreshSideResize = function () {
    const active = !!PR.side && desktop.matches;
    if (!active) endDrag();
    grip.hidden = !active;
    updateValues();
  };
  function reset() {
    endDrag();
    const point = readingPoint();
    ratio = null;
    body.style.removeProperty("--side-w");
    updateValues();
    finishLayout(point);
  }

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary || !PR.side || !desktop.matches) return;
    e.preventDefault();
    drag = { pointer: e.pointerId, x: e.clientX, width: panelWidth(), point: readingPoint() };
    grip.focus({ preventScroll: true });
    grip.setPointerCapture(e.pointerId);
    body.classList.add("side-resizing");
    PR.$("#selbar").classList.remove("open");
    PR.$("#blockbar").classList.remove("open");
    PR.hidePopover();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    pendingWidth = drag.width + drag.x - e.clientX;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (drag) setWidth(pendingWidth, drag.point);
    });
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => grip.addEventListener(name, endDrag));
  window.addEventListener("blur", endDrag);
  grip.addEventListener("dblclick", reset);
  grip.addEventListener("keydown", (e) => {
    if (!PR.side || !desktop.matches) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { endDrag(); return; }
    if (e.key === "Enter") { reset(); return; }
    const point = readingPoint(), step = e.shiftKey ? 48 : 16;
    const w = e.key === "Home" ? viewport() - minReader : e.key === "End" ? minPanel
      : panelWidth() + (e.key === "ArrowLeft" ? step : -step);
    setWidth(w, point);
    ratio = panelWidth() / viewport();
    finishLayout(point);
  });
  window.addEventListener("resize", PR.debounce(() => {
    endDrag();
    const point = readingPoint();
    if (desktop.matches && ratio != null) setWidth(ratio * viewport(), point);
    else body.style.removeProperty("--side-w");
    keepPlace(point);
    PR.refreshSideResize();
    if (PR.refreshPageSize) PR.refreshPageSize();
  }, 120));
  PR.refreshSideResize();
})(window.PR);
