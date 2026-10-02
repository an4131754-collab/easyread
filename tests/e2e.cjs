// 端到端測試：在臨時文獻庫上跑一遍文獻庫頁和閱讀頁的主要操作，確認都寫進了檔案。
// 用法：node tests/e2e.cjs [論文目錄（預設 library 裡第一篇）]
// 需要：專案 .venv、Node、playwright（找不到時讀 PLAYWRIGHT 環境變數）、本機 Chrome 或 Edge。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PY = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
const pw = process.env.PLAYWRIGHT || 'playwright';
const { chromium } = require(pw);
const BROWSER = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);

const LIB = fs.mkdtempSync(path.join(os.tmpdir(), 'easyread-e2e-'));
const SRC = process.argv[2] || fs.readdirSync(path.join(ROOT, 'library')).map((d) => path.join(ROOT, 'library', d)).find((d) => fs.existsSync(path.join(d, 'paper.json')) && JSON.parse(fs.readFileSync(path.join(d, 'paper.json'), 'utf8')).blocks.length > 50);
const PID = path.basename(SRC);
const ROOM = path.join(LIB, PID);
const env = { ...process.env, PYTHONUTF8: '1', EASYREAD_LIBRARY: LIB };
const disk = (name = 'reader') => JSON.parse(fs.readFileSync(path.join(ROOM, name + '.json'), 'utf8'));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; };
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓ ' + msg); };
const cli = (...args) => execFileSync(PY, ['-m', 'easyread', ...args], { env, cwd: ROOT }).toString();

(async () => {
  fs.cpSync(SRC, ROOM, { recursive: true, filter: (s) => !/history|job\.json|\.lock/.test(s) });
  fs.writeFileSync(path.join(ROOM, 'reader.json'), JSON.stringify({ schema: 2, rev: 0, edits: {}, notes: {}, paper_note: {}, progress: {} }));
  fs.writeFileSync(path.join(ROOM, 'item.json'), JSON.stringify({ added: new Date().toISOString(), tags: [], status: 'unread' }));
  const srv = spawn(PY, ['-m', 'easyread', 'serve', '--port', '0'], { env, cwd: ROOT });
  const url = await new Promise((res, rej) => { srv.stdout.on('data', (d) => { const m = String(d).match(/http:\/\/[\d.:]+/); if (m) res(m[0]); }); setTimeout(() => rej(new Error('服務沒起來')), 15000); });
  console.log('server', url, 'library', LIB);
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const saved = () => page.waitForFunction(() => document.querySelector('.save-state').dataset.s === 'saved', null, { timeout: 8000 });
  const shot = (name) => page.screenshot({ path: path.join(__dirname, 'shots', name + '.png') });
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

  try {
    console.log('1. 文獻庫');
    await page.goto(url + '/');
    await page.waitForSelector('.row');
    ok(await page.$$eval('.row', (r) => r.length) === 1, '文獻庫列出論文');
    await page.fill('#q', '誤差條');
    await page.waitForTimeout(250);
    ok(await page.$$eval('.row', (r) => r.length) === 1, '搜尋能找到');
    await page.fill('#q', '沒有這種論文xyz');
    await page.waitForTimeout(250);
    ok(await page.$$eval('.row', (r) => r.length) === 0, '搜尋不到時列表為空');
    await page.fill('#q', '');
    await page.waitForTimeout(250);
    await page.click('.row');
    await page.waitForSelector('#catInput');
    await page.fill('#catInput', '統計方法');
    await page.press('#catInput', 'Enter');
    await page.waitForFunction(() => document.querySelector('.side [data-cat]'));
    ok(await until(() => disk('item').tags.includes('統計方法')), '新建分類並放進論文，寫入 item.json');
    await page.click('.side .srow[data-cat="統計方法"]', { button: 'right' });
    await page.click('#ctxmenu button:has-text("置頂")');
    await page.waitForFunction(() => document.querySelector('.side [data-pinrow][data-cat]'));
    ok(true, '分類可以置頂');
    await page.click('[data-status="reading"]');
    await page.waitForTimeout(400);
    ok(disk('item').status === 'reading', '改閱讀狀態寫入 item.json');
    await shot('library');

    console.log('2. 閱讀頁');
    await page.goto(url + '/read/' + PID);
    await page.waitForSelector('#paper .blk');
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => ({
      blocks: document.querySelectorAll('#paper > .blk').length,
      display: document.querySelectorAll('.blk-math .katex-display').length,
      errs: document.querySelectorAll('.katex-error').length,
      tables: document.querySelectorAll('table.tbl').length,
      barFixed: getComputedStyle(document.querySelector('#bar')).position,
    }));
    ok(m.errs === 0 && m.display > 0, 'KaTeX 公式全部渲染（' + m.display + ' 個行間公式）');
    ok(m.barFixed === 'fixed', '頂欄常駐');
    await page.evaluate(() => scrollTo(0, 3000));
    await page.waitForTimeout(300);
    ok(await page.$eval('#bar', (b) => b.getBoundingClientRect().top) === 0, '往下讀頂欄也不收起');

    console.log('3. 字號');
    const fs0 = await page.evaluate(() => PR.prefs.fs);
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    ok(await page.evaluate(() => PR.prefs.fs) === fs0 + 2, '按兩下 = 字號 +2');
    await page.click('[data-act="settings"]');
    await page.$eval('#settings [data-r="fs"]', (r) => { r.value = 22; r.dispatchEvent(new Event('input', { bubbles: true })); });
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()) === '22px', '滑桿直接拖到 22px');
    await shot('settings');
    await page.keyboard.press('Digit0');
    await page.mouse.click(700, 500);

    console.log('4. 點段落出操作條，寫筆記');
    const firstPara = await page.$eval('#paper .blk-para:not(.abstract)', (e) => e.dataset.id);
    await page.evaluate((id) => { document.getElementById('b-' + id).scrollIntoView({ block: 'center' }); }, firstPara);
    await page.click('#b-' + firstPara + ' .zh', { position: { x: 30, y: 10 } });
    await page.waitForSelector('#blockbar.open');
    await shot('blockbar');
    await page.click('#blockbar button[title^="筆記"]');
    await page.waitForSelector('.card.mine textarea');
    await page.keyboard.type('這一段講的是動機。');
    await page.keyboard.press('Escape');
    await saved();
    ok(Object.values(disk().notes).some((n) => n.anchor === firstPara && n.body.includes('動機')), '段落筆記寫入 reader.json');

    console.log('5. 選中文字：彩色劃線、提問');
    const selectIn = (id, n) => page.evaluate(([id, n]) => {
      const zh = document.querySelector('#b-' + id + ' .zh');
      const w = document.createTreeWalker(zh, NodeFilter.SHOW_TEXT);
      const t = w.nextNode();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, Math.min(n, t.data.length));
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const rect = r.getBoundingClientRect();
      zh.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left, clientY: rect.top }));
      return r.toString();
    }, [id, n]);
    const paras = await page.$$eval('#paper .blk-para', (els) => els.slice(2, 6).map((e) => e.dataset.id));
    await page.evaluate((id) => document.getElementById('b-' + id).scrollIntoView({ block: 'center' }), paras[0]);
    const q1 = await selectIn(paras[0], 8);
    await page.waitForSelector('#selbar.open');
    await shot('selbar');
    await page.click('#selbar button[data-color="green"]');
    await saved();
    ok(Object.values(disk().notes).some((n) => n.kind === 'highlight' && n.color === 'green' && n.quote === q1), '綠色劃線寫入 reader.json');
    ok(await page.$('#b-' + paras[0] + ' mark.hl.c-green'), '劃線顯示為綠色');
    await page.evaluate((id) => document.getElementById('b-' + id).scrollIntoView({ block: 'center' }), paras[1]);
    await selectIn(paras[1], 6);
    await page.waitForSelector('#selbar.open');
    await page.keyboard.press('q');
    await page.waitForSelector('.card.mine textarea');
    await page.keyboard.type('這裡為什麼這樣說？');
    await page.keyboard.press('Escape');
    await saved();
    const q = Object.values(disk().notes).find((n) => n.kind === 'question');
    ok(q && q.body.includes('為什麼'), '選中文字後按 Q 提問，寫入 reader.json');

    console.log('6. agent 回覆出現在頁面');
    ok(cli('status', PID).includes('[待回答]'), 'easyread status 能看到待回答的問題');
    fs.writeFileSync(path.join(LIB, 'reply.json'), JSON.stringify([{ reply_to: q.id, kind: 'reply', body: '因為作者在這裡要引出後文的框架。' }]));
    cli('discuss', PID, '--from', path.join(LIB, 'reply.json'));
    await page.waitForSelector('.card.agent[data-anchor="' + paras[1] + '"]', { timeout: 8000 });
    ok(true, '回覆幾秒內出現在對應段落旁');

    console.log('7. 改譯文、譯者稿更新不覆蓋');
    const editId = paras[2];
    await page.evaluate((id) => document.getElementById('b-' + id).scrollIntoView({ block: 'center' }), editId);
    await page.dblclick('#b-' + editId + ' .zh', { position: { x: 40, y: 12 } });
    await page.waitForSelector('#b-' + editId + ' textarea.editor');
    await page.$eval('#b-' + editId + ' textarea.editor', (t) => { t.value = '【我的譯法】' + t.value; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.keyboard.press('Control+Enter');
    await saved();
    ok(disk().edits[editId].zh.startsWith('【我的譯法】'), '改過的譯文寫入 reader.json');
    const pj = disk('paper');
    pj.blocks.find((b) => b.id === editId).zh += '（譯者修訂）';
    fs.writeFileSync(path.join(ROOM, 'paper.json'), JSON.stringify(pj, null, 1));
    await page.waitForSelector('#b-' + editId + ' .stale-tag', { timeout: 8000 });
    ok((await page.$eval('#b-' + editId + ' .zh', (e) => e.textContent)).startsWith('【我的譯法】'), '譯者稿更新後仍顯示我的版本，並提示對比');

    console.log('8. 筆記面板與論文筆記');
    await page.keyboard.press('m');
    await page.waitForSelector('#notespanel .card');
    ok(await page.$$eval('#notespanel .card', (c) => c.length) >= 4, '筆記面板按原文順序列出批註');
    await page.click('[data-np="paper"]');
    await page.fill('#paperNote', '核心觀點：評測是實驗，要報誤差條。');
    await page.waitForTimeout(900);
    await saved();
    ok((disk().paper_note || {}).body.includes('誤差條'), '論文筆記寫入 reader.json');
    await shot('notespanel');
    await page.keyboard.press('Escape');

    console.log('9. 術語替換（只算不改）');
    const n = await page.evaluate(() => PR.replaceTerm('標準誤差', '標準誤', true));
    ok(n > 10, '術語替換能找到 ' + n + ' 處');

    console.log('10. 斷線暫存、恢復補存');
    await page.route('**/ops', (route) => route.abort());
    await page.evaluate(() => { const x = Object.values(PR.state.reader.notes).find((z) => z.kind === 'note'); PR.saveNote(Object.assign({}, x, { body: x.body + '（斷線時補充）' })); });
    await page.waitForFunction(() => document.querySelector('.save-state').dataset.s === 'offline', null, { timeout: 8000 });
    ok(!JSON.stringify(disk()).includes('斷線時補充'), '斷線：修改留在瀏覽器佇列');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#paper .blk');
    ok(await page.evaluate(() => PR.store.pending) >= 1, '重新整理後待存修改還在');
    await page.unroute('**/ops');
    await page.evaluate(() => PR.flush());
    await saved();
    ok(JSON.stringify(disk()).includes('斷線時補充'), '恢復後補存進 reader.json');

    console.log('11. 窄屏與手機');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '手機寬度下沒有橫向滾動');
    await shot('mobile');
    ok(errors.length === 0, '頁面沒有指令碼錯誤' + (errors.length ? '：' + errors.join(' | ') : ''));
    console.log('ALL PASS');
  } catch (e) {
    console.log(String(e.stack || e));
    await shot('fail').catch(() => {});
    if (errors.length) console.log('page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(LIB, { recursive: true, force: true });
  }
})();
