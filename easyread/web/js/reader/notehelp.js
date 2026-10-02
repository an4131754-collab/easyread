/* 論文筆記的 AI 幫手：點評、幫我改、起草稿。結果流到筆記下方的小框裡，讀者決定替換、追加還是丟掉。
   和“問 AI”分開（不佔右側面板、不進對話記錄）；服務端見 notehelp.py。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const NAMES = { review: "AI 點評", revise: "AI 改過的筆記", draft: "AI 起的草稿" };
  const ai = { mode: null, text: "", model: "", streaming: false, error: "", ctrl: null };
  const noteNow = () => { const ta = PR.$("#paperNote"); return ta ? ta.value : (S.reader.paper_note || {}).body || ""; };

  PR.noteHelpOn = () => PR.store.mode === "server" && PR.feature("chat") && PR.canChat && PR.canChat();

  /* 工具欄上的按鈕：筆記空著時只有“起草稿” */
  PR.noteHelpButtons = function () {
    if (!PR.noteHelpOn()) return "";
    const empty = !noteNow().trim();
    const dis = ai.streaming ? " disabled" : "";
    return '<span class="nh-btns">' + (empty ? '<button class="btn sm" data-nh="draft"' + dis + ">" + PR.icon("sparkle", "sm") + "AI 起個草稿</button>"
      : '<button class="btn sm" data-nh="review"' + dis + ">" + PR.icon("sparkle", "sm") + "AI 點評</button>" +
        '<button class="btn sm" data-nh="revise"' + dis + ">AI 幫我改</button>") + "</span>";
  };

  PR.noteHelpBox = function () {
    if (!ai.mode) return "";
    const apply = ai.mode === "review" ? '<button class="btn sm" data-nh="append">追加到筆記末尾</button>'
      : '<button class="btn sm accent" data-nh="replace">替換我的筆記</button><button class="btn sm" data-nh="append">追加到末尾</button>';
    return '<div class="np-ai"><div class="np-ai-head"><b>' + NAMES[ai.mode] + "</b>" + (ai.model ? "<small>" + PR.esc(ai.model) + "</small>" : "") + '<span class="grow"></span>' +
      (ai.streaming ? '<button class="btn sm" data-nh="stop">停止</button>' : '<button class="btn icon" data-nh="close" title="丟掉">×</button>') + "</div>" +
      '<div class="np-ai-body">' + (ai.text ? PR.mdBlocks(ai.text) : ai.streaming ? '<p class="hint"><span class="spin"></span> 正在想…</p>' : "") +
      (ai.error ? '<p class="err">' + PR.esc(ai.error) + "</p>" : "") + "</div>" +
      (!ai.streaming && ai.text ? '<div class="np-ai-acts">' + apply + "</div>" : "") + "</div>";
  };

  const paint = () => { const box = PR.$("#notespanel .np-ai"); if (box) box.outerHTML = PR.noteHelpBox(); else PR.renderNotesPanel(); };
  const paintSoon = PR.debounce(paint, 80);

  async function run(mode) {
    ai.ctrl && ai.ctrl.abort();
    const note = noteNow();  // 先取再重畫：輸入框裡可能有還沒存下的字（自動儲存有 0.6 秒延遲）
    if (note !== ((S.reader.paper_note || {}).body || "")) PR.commit({ op: "paper_note", body: note });
    Object.assign(ai, { mode, text: "", model: "", streaming: true, error: "", ctrl: new AbortController() });
    PR.renderNotesPanel();
    try {
      const res = await fetch("/api/p/" + PR.pid + "/notehelp", {
        method: "POST", signal: ai.ctrl.signal, headers: { "Content-Type": "application/json", "X-Token": PR.token || "" },
        body: JSON.stringify({ mode, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "HTTP " + res.status);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.model) ai.model = ev.model;
          if (ev.t) { ai.text += ev.t; paintSoon(); }
          if (ev.error) ai.error = ev.error;
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") ai.error = "沒能完成：" + e.message;
    }
    ai.streaming = false; ai.ctrl = null;
    PR.renderNotesPanel();
  }

  function setNote(body) {
    PR.commit({ op: "paper_note", body });
    ai.mode = null;
    PR.renderNotesPanel();
  }

  PR.$("#notespanel").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-nh]");
    if (!b) return;
    const act = b.dataset.nh;
    if (NAMES[act]) return run(act);
    if (act === "stop") { ai.ctrl && ai.ctrl.abort(); return; }
    if (act === "close") { ai.mode = null; return PR.renderNotesPanel(); }
    const cur = noteNow();
    if (act === "append") return setNote((cur.trim() ? cur.replace(/\s+$/, "") + "\n\n" : "") + (ai.mode === "review" ? "**AI 點評**\n\n" : "") + ai.text.trim());
    if (act === "replace") {
      setNote(ai.text.trim());
      PR.toast("已替換論文筆記", { label: "撤銷", fn: () => setNote(cur) });
    }
  });
})(window.PR);
