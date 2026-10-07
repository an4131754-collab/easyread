// Real-browser regressions on a temporary library; no AI service is called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const library = fs.mkdtempSync(path.join(os.tmpdir(), 'easyread-annotation-'));
const room = path.join(library, 'fixture');
fs.mkdirSync(room);
const write = (name, value) => fs.writeFileSync(path.join(room, name + '.json'), JSON.stringify(value));
write('paper', { meta: { title_en: 'Annotation regression' }, blocks: [
  { id: 'p1', type: 'para', en: 'English paragraph with a selected phrase.', zh: '中文段落包含要選取的句子。', page: 1 },
  { id: 'p2', type: 'para', en: 'Another English paragraph.', zh: '另一個中文段落。', page: 1 }
] });
write('reader', { schema: 2, rev: 0, edits: {}, progress: {}, notes: {
  plain: { id: 'plain', anchor: 'p1', key: 'p1', lang: 'en', quote: 'English paragraph', kind: 'highlight', color: 'green', body: '' },
  withnote: { id: 'withnote', anchor: 'p2', key: 'p2', lang: 'en', quote: 'Another English', kind: 'note', color: 'blue', body: '這是必須保留的筆記。' }
} });
write('item', { added: new Date().toISOString(), status: 'unread', tags: [] });
write('chat', { threads: [{ id: 'seed', title: 'Existing discussion', model: 'fake', messages: [
  { role: 'user', content: '請解釋論文', anchor: 'p1' },
  { role: 'assistant', id: 'a1', anchor: 'p1', content: '第一段回答有值得追問的內容。', model: 'Fake' },
  { role: 'user', content: '繼續說明' },
  { role: 'assistant', id: 'a2', anchor: 'p1', content: '第二段回答有另一個觀點。', model: 'Fake' }
] }, { id: 'other', title: 'Other discussion', model: 'fake', messages: [] }] });
const metadataPath = path.join(root, '.server.json');
const originalMetadata = fs.existsSync(metadataPath) ? fs.readFileSync(metadataPath) : null;
const server = spawn(path.join(root, '.venv', 'Scripts', 'python.exe'), ['-m', 'easyread', 'serve', '--port', '0'], {
  cwd: root, env: { ...process.env, EASYREAD_LIBRARY: library, PYTHONUTF8: '1' }
});

async function select(page, selector, length = 7) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate(([selector, length]) => {
    const el = document.querySelector(selector);
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, Math.min(length, node.length));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [selector, length]);
}

(async () => {
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('server timeout')), 15000);
      server.once('error', reject);
      server.stdout.on('data', d => { const m = String(d).match(/http:\/\/[\d.:]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    });
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + '/read/fixture', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#b-p1 .zh');
    await page.click('[data-mode="bi"]');
    if (process.argv[2] !== 'chat') {
      // A normal single click after selecting highlighted text should still open its controls.
      await select(page, '#b-p1 .en mark[data-note="plain"]');
      await page.locator('mark[data-note="plain"]').first().click();
      await page.click('#popover.open [data-hl="del"]');
      assert.equal(await page.locator('mark[data-note="plain"]').count(), 0, 'both language marks must disappear');
      console.log('PASS plain bilingual highlight cancellation');
      assert.equal(await page.locator('mark[data-note="withnote"]').count(), 2, 'adding a note must retain both language marks');
      await page.locator('mark[data-note="withnote"]').first().click();
      assert.equal(await page.locator('#popover.open [data-hl="del"]').count(), 1, 'clicking a highlight with a note must offer cancellation');
      await page.click('#popover.open [data-hl="del"]');
      assert.equal(await page.locator('mark[data-note="withnote"]').count(), 0);
      await page.waitForFunction(() => document.querySelector('.save-state').dataset.s === 'saved');
      const note = JSON.parse(fs.readFileSync(path.join(room, 'reader.json'))).notes.withnote;
      assert.equal(note.body, '這是必須保留的筆記。');
      assert.ok(!note.deleted, 'cancelling a mark must not delete its note');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); await page.waitForSelector('#b-p2 .en');
      assert.equal(await page.locator('mark[data-note="withnote"]').count(), 0, 'cancellation must survive reload');
      await page.evaluate(() => PR.toggleNotesPanel(true));
      await page.click('#notespanel [data-nf="hl"]');
      assert.equal(await page.locator('#notespanel .card[data-note="withnote"]').count(), 0, 'cancelled marks leave the highlight filter');
      await page.click('#notespanel [data-nf="mine"]');
      assert.equal(await page.locator('#notespanel .card[data-note="withnote"]').count(), 1, 'the retained note remains available');
      await page.evaluate(() => PR.toggleNotesPanel(false));
      console.log('PASS cancellation with note retention and reload');
    }
    if (process.argv[2] !== 'highlight') {
      let sent;
      await page.route('**/api/p/fixture/chat', async route => {
        if (route.request().method() === 'GET') {
          const data = JSON.parse(fs.readFileSync(path.join(room, 'chat.json')));
          return route.fulfill({ json: { ...data, models: [{ id: 'fake', label: 'Fake', supports_images: true }], default: 'fake', limits: {} } });
        }
        sent = route.request().postDataJSON();
        const data = JSON.parse(fs.readFileSync(path.join(room, 'chat.json')));
        data.threads[0].messages.push({ role: 'user', content: sent.text, refs: sent.refs, anchor: sent.anchor }, { role: 'assistant', id: 'a3', content: 'Mock follow-up', model: 'Fake' });
        write('chat', data);
        return route.fulfill({ contentType: 'application/x-ndjson', body: '{"t":"Mock follow-up"}\n{"done":true,"id":"a3"}\n' });
      });
      await page.evaluate(() => { PR.setCurrent('p1'); PR.chatAsk({}); });
      await page.click('[data-c="list"]'); await page.click('.ch-thread[data-t="seed"]');
      await page.fill('#chatInput', '比較這些片段');
      await select(page, '.cm.ai[data-id="a1"] .body');
      await page.waitForSelector('#selbar.open');
      assert.equal(await page.locator('#selbar [data-s="chat"]').count(), 1, 'AI answer selection must offer follow-up');
      await page.click('#selbar [data-s="chat"]');
      await page.waitForSelector('.chip-ctx.ai-ref');
      assert.equal(await page.locator('.chip-ctx.ai-ref').count(), 1);
      await select(page, '.cm.ai[data-id="a2"] .body');
      await page.click('#selbar.open [data-s="chat"]');
      await page.waitForFunction(() => document.querySelectorAll('.chip-ctx.ai-ref').length === 2);
      assert.equal(await page.locator('.chip-ctx.ai-ref').count(), 2);
      assert.equal(await page.locator('#chatInput').inputValue(), '比較這些片段', 'adding references must preserve the draft');
      await select(page, '.cm.ai[data-id="a1"] .body');
      await page.click('#selbar.open [data-s="chat"]');
      await page.waitForTimeout(80);
      assert.equal(await page.locator('.chip-ctx.ai-ref').count(), 2, 'duplicate excerpts must not add a chip');
      await page.locator('.chip-ctx.ai-ref button').first().click();
      assert.equal(await page.locator('.chip-ctx.ai-ref').count(), 1);
      await select(page, '.cm.ai[data-id="a1"] .body'); await page.click('#selbar.open [data-s="chat"]');
      await page.waitForFunction(() => document.querySelectorAll('.chip-ctx.ai-ref').length === 2);
      const shots = path.join(root, 'tests', 'shots'); fs.mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shots, 'reply-reference-chips.png') });
      await page.click('[data-c="send"]');
      await page.waitForSelector('.cm.ai[data-id="a3"] .acts');
      assert.equal(sent.text, '比較這些片段');
      assert.equal(sent.anchor, 'p1', 'AI excerpts must retain the current paper context');
      assert.deepEqual(sent.refs.filter(r => r.source === 'assistant').map(r => r.message), ['a2', 'a1']);
      assert.equal(await page.locator('.cm.user [data-c="go-reply"]').count(), 2);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('#b-p1 .zh'); await page.evaluate(() => PR.chatAsk({}));
      await page.click('[data-c="list"]'); await page.click('.ch-thread[data-t="seed"]');
      assert.equal(await page.locator('.cm.user [data-c="go-reply"]').count(), 2, 'reply references survive reload');
      await page.locator('.cm.user [data-c="go-reply"]').first().click();
      await select(page, '.cm.ai[data-id="a1"] .body'); await page.click('#selbar.open [data-s="chat"]');
      await page.waitForSelector('.chip-ctx.ai-ref');
      await page.click('[data-c="list"]'); await page.click('.ch-thread[data-t="other"]');
      assert.equal(await page.locator('.chip-ctx.ai-ref').count(), 0, 'reply references cannot leak into a different thread');
      console.log('PASS AI reply selection, multi-reference/dedup/removal, draft retention, send, reload and thread isolation');
    }
    assert.deepEqual(errors, [], 'no browser exceptions');
  } finally {
    if (browser) await browser.close();
    server.kill();
    if (fs.existsSync(metadataPath) && JSON.parse(fs.readFileSync(metadataPath)).pid === server.pid) {
      if (originalMetadata) fs.writeFileSync(metadataPath, originalMetadata);
      else fs.unlinkSync(metadataPath);
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
