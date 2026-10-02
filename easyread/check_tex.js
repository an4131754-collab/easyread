// 用頁面同一份 KaTeX 檢查 paper.json / discussion.json 裡的全部 TeX。
// 輸入（stdin）：[[位置, tex, 是否行間], ...]；每個出錯的公式輸出一行。
const katex = require(process.argv[2]);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let bad = 0;
  for (const [where, tex, display] of JSON.parse(input)) {
    try {
      katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore" });
    } catch (e) {
      bad++;
      console.log(`${where}：TeX 渲染失敗 ${JSON.stringify(tex).slice(0, 80)} —— ${String(e.message).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  process.exit(bad ? 1 : 0);
});
