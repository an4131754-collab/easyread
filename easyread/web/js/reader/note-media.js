/* Persistent references with visual thumbnails and an image-first picker. */
(function (PR) {
  "use strict";
  const S = PR.state;
  const refs = (n) => Array.isArray(n.media_refs) ? n.media_refs.filter((r) => r && r.id) : [];
  const expanded = new Map();
  let chooser = null, choosingNote = null, renamingNote = null, finishRename = null, returnFocus = null;
  const find = (id) => (S.reader.notes || {})[id];
  const escape = PR.esc;
  const label = (ref) => ref.title || PR.media.label(PR.media.resolve(ref) || ref);

  function html(note, surface = "margin") {
    const active = expanded.get(surface + ":" + note.id);
    return '<div class="note-media" data-media-note="' + escape(note.id) + '" data-media-surface="' + surface + '">' + refs(note).map((ref) => {
      const b = PR.media.resolve(ref), open = active === ref.id;
      return '<div class="note-media-item"><div class="note-media-row"><button class="note-media-toggle" data-note-media="toggle" data-media-id="' + escape(ref.id) + '" aria-expanded="' + open + '" title="' + PR.t("点击展开或收起") + '"><span class="note-media-thumb" aria-hidden="true">' + PR.media.thumbnail(b) + '</span><span class="note-media-title">' + escape(label(ref)) + '</span><span class="media-page">' + PR.t("第 {page} 页", { page: (b || ref).page || "?" }) + '</span></button><button class="note-media-rename" data-note-media="rename" data-media-id="' + escape(ref.id) + '" aria-label="' + escape(PR.t("修改名称：{name}", { name: label(ref) })) + '" title="' + PR.t("修改图表名称") + '">' + PR.icon("edit", "sm") + '</button><button class="note-media-remove" data-note-media="remove" data-media-id="' + escape(ref.id) + '" aria-label="' + escape(PR.t("移除关联：{name}", { name: label(ref) })) + '" title="' + PR.t("移除关联") + '">×</button></div>' + (open ? '<div class="note-media-detail">' + PR.media.html(ref) + '</div>' : "") + '</div>';
    }).join("") + '</div>';
  }
  function repaint(id) {
    const note = find(id);
    if (!note || note.deleted) return;
    document.querySelectorAll(".note-media").forEach((el) => { if (el.dataset.mediaNote === id) el.outerHTML = html(note, el.dataset.mediaSurface); });
    PR.layoutMargin();
  }
  function save(id, list) {
    const n = find(id);
    if (!n || n.deleted) return;
    const card = Array.from(document.querySelectorAll(".card[data-note]")).find((c) => c.dataset.note === id && c.querySelector("textarea"));
    const ta = card && card.querySelector("textarea");
    const next = { ...n, body: ta ? ta.value.trim() : n.body, media_refs: list,
      kind: list.length && n.kind === "highlight" ? "note" : n.kind };
    if (!ta && !list.length && !(next.body || "").trim()) PR.finishNote(next, "");
    else PR.saveNote(next);
    repaint(id);
  }
  function attach(id, block) {
    const n = find(id);
    if (!n || n.deleted || !PR.media.isMedia(block)) return false;
    if (!refs(n).some((r) => PR.media.resolve(r)?.id === block.id)) save(id, [...refs(n), PR.media.reference(block)]);
    return true;
  }
  function rename(button) {
    if (button.closest(".note-media-row").querySelector("input")) return;
    finishRename?.(true);
    const card = button.closest(".card[data-note]"), id = card.dataset.note;
    const rid = button.dataset.mediaId, ref = refs(find(id) || {}).find((r) => r.id === rid);
    if (!ref) return;
    const toggle = button.previousElementSibling;
    const editor = PR.el("div", { class: "note-media-edit" });
    editor.innerHTML = toggle.innerHTML;
    const input = PR.el("input", { class: "note-media-name-input", type: "text", maxlength: "120", "aria-label": PR.t("图表名称") });
    input.value = label(ref);
    editor.querySelector(".note-media-title").replaceWith(input);
    renamingNote = id;
    let finished = false;
    const finish = (commit, focus = false) => {
      if (finished) return;
      finished = true;
      finishRename = null;
      renamingNote = null;
      const latest = find(id);
      const title = input.value.trim();
      if (commit && latest && !latest.deleted && title !== label(ref)) {
        const list = refs(latest).map((r) => r.id === rid ? { ...r, title } : r);
        // Keep the clicked controls mounted while blur saves the name.
        PR.saveNote({ ...latest, media_refs: list });
        const updated = list.find((r) => r.id === rid);
        if (updated) {
          toggle.querySelector(".note-media-title").textContent = label(updated);
          button.setAttribute("aria-label", PR.t("修改名称：{name}", { name: label(updated) }));
          button.nextElementSibling.setAttribute("aria-label", PR.t("移除关联：{name}", { name: label(updated) }));
        }
      }
      editor.replaceWith(toggle);
      if (focus) button.focus({ preventScroll: true });
      PR.layoutMargin();
    };
    finishRename = finish;
    input.addEventListener("input", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault(); finish(e.key === "Enter", true);
      }
    });
    input.addEventListener("blur", () => finish(true));
    toggle.replaceWith(editor);
    input.focus({ preventScroll: true }); input.select();
  }
  function closePicker() {
    if (!chooser) return;
    const note = find(choosingNote);
    chooser.remove(); chooser = null; choosingNote = null;
    const editor = returnFocus?.closest(".card")?.querySelector("textarea");
    if (editor?.isConnected) editor.focus({ preventScroll: true });
    else {
      if (note) PR.finishNote(note, note.body || "");
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
  }
  function choose(noteId, button) {
    const n = find(noteId);
    if (!n || n.deleted) return;
    closePicker(); returnFocus = button; choosingNote = noteId;
    chooser = PR.el("div", { class: "media-picker-backdrop" });
    chooser.innerHTML = '<section class="media-picker" role="dialog" aria-modal="true" aria-labelledby="mediaPickerTitle"><div class="media-picker-head"><div><h3 id="mediaPickerTitle">' + PR.t("关联图表") + '</h3><p>' + PR.t("点选图表，或直接把正文图片拖进笔记") + '</p></div><button class="btn icon" data-media-close aria-label="' + PR.t("关闭") + '">×</button></div><div class="media-picker-list"></div></section>';
    document.body.appendChild(chooser);
    const list = chooser.querySelector(".media-picker-list");
    const selected = refs(n).map((r) => PR.media.resolve(r)?.id || r.id);
    list.innerHTML = PR.media.blocks().map((b) => '<button class="media-picker-option" data-pick-media="' + escape(b.id) + '" aria-pressed="' + selected.includes(b.id) + '" aria-label="' + escape(PR.media.label(b)) + '"><span class="media-option-thumb" aria-hidden="true">' + PR.media.thumbnail(b) + '</span><span class="media-option-label"><strong>' + escape(PR.media.label(b)) + '</strong><span>' + PR.t("第 {page} 页", { page: b.page || "?" }) + '</span><span class="media-option-check" aria-hidden="true">' + (selected.includes(b.id) ? '✓' : '') + '</span></span><span class="media-option-caption">' + escape(PR.media.caption(b)) + '</span></button>').join("") || '<p class="media-empty">' + PR.t("没有找到图表") + '</p>';
    chooser.querySelector("[data-media-close]").focus({ preventScroll: true });
    chooser.addEventListener("click", (e) => {
      if (e.target === chooser || e.target.closest("[data-media-close]")) return closePicker();
      const option = e.target.closest("[data-pick-media]");
      if (!option) return;
      attach(noteId, PR.blockById[option.dataset.pickMedia]);
      closePicker();
    });
  }
  // Capture before note-card navigation/editing handlers. Opening a reference must not move the paper.
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-note-media]");
    if (!button) {
      if (e.target.closest(".note-media .media-preview, .note-media-edit")) e.stopPropagation();
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    const card = button.closest(".card[data-note]");
    if (!card) return;
    const id = card.dataset.note, n = find(id);
    if (!n || n.deleted) return;
    if (button.dataset.noteMedia === "add") return choose(id, button);
    if (button.dataset.noteMedia === "rename") return rename(button);
    const root = button.closest("[data-media-note]");
    const key = root.dataset.mediaSurface + ":" + id;
    const rid = button.dataset.mediaId;
    if (button.dataset.noteMedia === "remove") {
      for (const surface of ["panel", "margin"]) if (expanded.get(surface + ":" + id) === rid) expanded.delete(surface + ":" + id);
      save(id, refs(n).filter((r) => r.id !== rid));
    } else {
      const open = expanded.get(key) !== rid;
      open ? expanded.set(key, rid) : expanded.delete(key);
      root.querySelectorAll('.note-media-detail').forEach((el) => el.remove());
      root.querySelectorAll('[data-note-media="toggle"]').forEach((el) => el.setAttribute("aria-expanded", "false"));
      button.setAttribute("aria-expanded", String(open));
      if (open) button.closest('.note-media-item').insertAdjacentHTML("beforeend", '<div class="note-media-detail">' + PR.media.html(refs(n).find((r) => r.id === rid)) + '</div>');
      PR.layoutMargin();
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!chooser) return;
    e.stopImmediatePropagation();
    if (e.key === "Escape") { e.preventDefault(); closePicker(); }
    if (e.key === "Tab") {
      const targets = Array.from(chooser.querySelectorAll("button:not([disabled]), input"));
      const first = targets[0], last = targets[targets.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
  PR.noteMedia = {
    html, attach, has: (n) => refs(n).length > 0, isChoosing: (id) => choosingNote === id || renamingNote === id, isRenaming: () => renamingNote !== null,
    markdown: (n) => refs(n).map((ref) => {
      const b = PR.media.resolve(ref), title = (label(ref) + " · " + PR.t("第 {page} 页", { page: (b || ref).page || "?" })).replace(/[\\[\]]/g, "\\$&");
      const link = PR.store.mode === "server" && b ? "[" + title + "](" + location.origin + location.pathname + "#b-" + encodeURIComponent(b.id) + ")" : title;
      return "  - " + PR.t("关联图表") + PR.t("：") + link + (b ? "" : " · " + PR.t("图表已变化或移除"));
    }).join("\n")
  };
  document.addEventListener("load", (e) => { if (e.target.matches && e.target.matches(".note-media img")) PR.layoutMargin(); }, true);
})(window.PR);
