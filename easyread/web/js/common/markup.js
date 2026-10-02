/* 行內標記：$TeX$、**粗體**、*斜體*、`程式碼`、[n] 引用，以及“公式 (1) / 表 2 / 第 2.2 節 / 附錄 A”這類交叉引用。
   譯文、討論、筆記都用同一套，使用者編輯時看到的就是這套原始標記。 */
(function (PR) {
  "use strict";
  const MATH = /(?<!\\)\$((?:\\\$|[^$])+?)(?<!\\)\$/g;
  const mathCache = new Map();

  PR.tex = function (tex, display) {
    const key = (display ? "D" : "I") + tex;
    if (mathCache.has(key)) return mathCache.get(key);
    let html;
    try {
      html = katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: "ignore", trust: false });
    } catch (e) {
      html = '<code title="公式渲染失敗">' + PR.esc(tex) + "</code>";
    }
    mathCache.set(key, html);
    return html;
  };

  function citeLinks(s) {
    return s.replace(/\[(\d+(?:\s*[,，–-]\s*\d+)*)\]/g, (m, inner) => {
      const parts = inner.split(/(\s*[,，–-]\s*)/);
      const linked = parts.map((p) => (/^\d+$/.test(p) && PR.refById && PR.refById[p])
        ? '<a class="cite" data-ref="' + p + '">' + p + "</a>" : p).join("");
      return "[" + linked + "]";
    });
  }

  function xref(kind, key, label) {
    const ix = PR.xindex && PR.xindex[kind];
    if (!ix || !ix[key]) return label;
    return '<a class="xref" data-kind="' + kind + '" data-key="' + PR.esc(key) + '">' + label + "</a>";
  }

  function xrefLinks(s) {
    // 公式 (9) 和 (10)：把這一串裡每個編號都鏈上
    s = s.replace(/公式\s*[（(]\d+[）)](?:\s*(?:和|與|及|、|或|,|，)\s*[（(]\d+[）)])*/g,
      (m) => m.replace(/[（(](\d+)[）)]/g, (mm, n) => xref("eq", n, mm)));
    s = s.replace(/公式\s*(\d+)(?![\d.）)])/g, (m, n) => xref("eq", n, m));
    s = s.replace(/表\s*(\d+)/g, (m, n) => xref("tab", n, m));
    s = s.replace(/圖\s*(\d+)/g, (m, n) => xref("fig", n, m));
    s = s.replace(/第\s*(\d+(?:\.\d+)*)\s*節/g, (m, n) => xref("sec", n, m));
    s = s.replace(/附錄\s*([A-Z])(?![a-zA-Z])/g, (m, n) => xref("sec", n, m));
    // 英文原文裡的
    s = s.replace(/\b(Equations?)\s+(\d+)(?:\s+(and)\s+(\d+))?/g, (m, w, a, and, b) =>
      w + " " + xref("eq", a, a) + (b ? " " + and + " " + xref("eq", b, b) : ""));
    s = s.replace(/\bTable\s+(\d+)/g, (m, n) => xref("tab", n, m));
    s = s.replace(/\bFigure\s+(\d+)/g, (m, n) => xref("fig", n, m));
    s = s.replace(/\bSection\s+(\d+(?:\.\d+)*)/g, (m, n) => xref("sec", n, m));
    s = s.replace(/\bAppendix\s+([A-Z])\b/g, (m, n) => xref("sec", n, m));
    return s;
  }

  /* AI 回答裡偶爾會帶出段落編號 [p4-5]、[eq7]，換成讀者看得懂的“式 7”“第 4 頁” */
  function blockLabel(s) {
    return s.replace(/\[([a-z]+\d*(?:-[\w-]+)?)\]/g, (m, id) => {
      const b = PR.blockById && PR.blockById[id];
      if (!b) return m;
      return b.type === "math" && b.tag ? "（式 " + b.tag + "）" : b.page ? "（第 " + b.page + " 頁）" : m;
    });
  }

  function inline(text, opts) {
    let s = blockLabel(PR.esc(text).replace(/\\\$/g, "$"));
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    if (opts.cite !== false) s = citeLinks(s);
    if (opts.xref !== false) s = xrefLinks(s);
    return s.replace(/\n/g, "<br>");
  }

  /* 一行/一段文字 -> HTML */
  PR.md = function (text, opts) {
    opts = opts || {};
    text = String(text == null ? "" : text);
    // 公式先換成佔位符再處理粗體等標記，這樣 **粗體裡帶 $公式$** 也能認出來
    const maths = [];
    MATH.lastIndex = 0;
    const s = text.replace(MATH, (m, t) => "" + (maths.push(t) - 1) + "");
    return inline(s, opts).replace(/(\d+)/g, (m, i) => PR.tex(maths[i].replace(/\\\$/g, "\\$"), false));
  };

  /* 多段文字（討論、筆記正文）：空行分段；$$...$$ 是行間公式——AI 常把它緊貼在上一行文字或列表後面，也要拆出來 */
  PR.mdBlocks = function (text, opts) {
    return String(text || "").trim().split(/\n\s*\n/).map((p) =>
      p.split(/(?<!\\)\$\$([\s\S]+?)\$\$/).map((part, i) =>
        i % 2 ? '<div class="eq">' + PR.tex(part.trim(), true) + "</div>" : para(part, opts)).join("")).join("");
  };

  function isTableDelimiter(line) {
    const trimmed = (line || "").trim();
    if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
    let parts = trimmed.split("|");
    if (trimmed.startsWith("|")) parts.shift();
    if (trimmed.endsWith("|")) parts.pop();
    if (parts.length === 0) return false;
    return parts.every((p) => /^\s*:?-+:?\s*$/.test(p));
  }

  function splitTableRow(line) {
    let s = (line || "").trim();
    const tecs = [];
    s = s.replace(/(?<!\\)\$((?:\\\$|[^$])+?)(?<!\\)\$/g, (m) => "" + (tecs.push(m) - 1) + "");
    s = s.replace(/\\\|/g, "\uE002");
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((cell) => {
      let c = cell.trim();
      c = c.replace(/\uE002/g, "|");
      c = c.replace(/(\d+)/g, (m, i) => tecs[i]);
      return c;
    });
  }

  function parseAlign(delimLine) {
    return splitTableRow(delimLine).map((col) => {
      const c = col.trim();
      const left = c.startsWith(":");
      const right = c.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "";
    });
  }

  function tableHtml(headerLine, delimLine, dataLines, opts) {
    const align = parseAlign(delimLine);
    const getStyle = (i) => (align[i] ? ' style="text-align:' + align[i] + '"' : "");
    const headCells = splitTableRow(headerLine);
    const head = "<tr>" + headCells.map((c, i) => "<th" + getStyle(i) + ">" + PR.md(c, opts) + "</th>").join("") + "</tr>";
    const colCount = headCells.length;
    const rows = dataLines.map((rowLine) => {
      const cells = splitTableRow(rowLine);
      while (cells.length < colCount) cells.push("");
      return "<tr>" + cells.slice(0, colCount).map((c, i) => "<td" + getStyle(i) + ">" + PR.md(c, opts) + "</td>").join("") + "</tr>";
    }).join("");
    return '<div class="tbl-wrap"><table class="tbl"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
  }

  function para(p, opts) {
    p = p.trim();
    if (!p) return "";

    // 1. 表格（Markdown GFM 表格：表頭 + 分隔行 + 資料行）
    const lines = p.split("\n");
    const dIdx = lines.findIndex((l, idx) => idx >= 1 && isTableDelimiter(l) && lines[idx - 1].includes("|"));
    if (dIdx >= 1) {
      const before = lines.slice(0, dIdx - 1);
      const headerLine = lines[dIdx - 1];
      const delimLine = lines[dIdx];
      let endIdx = dIdx + 1;
      while (endIdx < lines.length && lines[endIdx].includes("|") && lines[endIdx].trim()) {
        endIdx++;
      }
      const dataLines = lines.slice(dIdx + 1, endIdx);
      const after = lines.slice(endIdx);
      return (before.length ? para(before.join("\n"), opts) : "") +
        tableHtml(headerLine, delimLine, dataLines, opts) +
        (after.length ? para(after.join("\n"), opts) : "");
    }

    // 2. 引用塊（> 開頭）
    const qIdx = lines.findIndex((l) => /^\s*>/.test(l));
    if (qIdx >= 0) {
      let qEnd = qIdx;
      while (qEnd < lines.length && /^\s*>/.test(lines[qEnd])) qEnd++;
      const before = lines.slice(0, qIdx);
      const qText = lines.slice(qIdx, qEnd).map((l) => l.replace(/^\s*>\s?/, "")).join("\n");
      const after = lines.slice(qEnd);
      return (before.length ? para(before.join("\n"), opts) : "") +
        "<blockquote>" + para(qText, opts) + "</blockquote>" +
        (after.length ? para(after.join("\n"), opts) : "");
    }

    // 3. 標題
    const h = p.match(/^#{1,4}\s+(.+)$/);
    if (h) return '<p class="md-h">' + PR.md(h[1], opts) + "</p>";

    // 4. 列表：從某行起每行都以 “- ”“* ”或“1. ”開頭（AI 的回答常用“引子：\n- …\n- …”）
    const isItem = (l) => /^\s*([-*•]|\d+[.、)])\s+/.test(l);
    const k = lines.findIndex(isItem);
    if (k >= 0 && lines.slice(k).every(isItem)) {
      const ordered = /^\s*\d/.test(lines[k]);
      return (k ? "<p>" + PR.md(lines.slice(0, k).join("\n"), opts) + "</p>" : "") + (ordered ? "<ol>" : "<ul>") +
        lines.slice(k).map((l) => "<li>" + PR.md(l.replace(/^\s*([-*•]|\d+[.、)])\s+/, ""), opts) + "</li>").join("") + (ordered ? "</ol>" : "</ul>");
    }

    return "<p>" + PR.md(p, opts) + "</p>";
  }

  /* 去掉標記的純文字，給目錄、列表摘要用 */
  PR.plain = (text) => String(text || "").replace(MATH, (m, t) => t).replace(/\*\*|`/g, "");
})(window.PR);
