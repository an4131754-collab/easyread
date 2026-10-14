// Integration acceptance uses isolated disk data and no model/network calls.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {spawn}=require('child_process');const {chromium}=require(process.env.PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'easyread-integration-'));
const lib=path.join(home,'library'),room=path.join(lib,'fixture');fs.mkdirSync(room,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=','base64');
fs.mkdirSync(path.join(room,'pages'));fs.writeFileSync(path.join(room,'pages','page.png'),png);
const write=(file,obj)=>fs.writeFileSync(path.join(room,file+'.json'),JSON.stringify(obj));
const blocks=[{id:'p1',type:'para',en:'Hiddenkeyword: the original passage about $x^2 + y^2$.',zh:'中文段落與公式 $x^2 + y^2$。',page:1},
 {id:'f1',type:'figure',num:'1',src:'pages/page.png',caption_en:'A sample figure.',caption_zh:'測試圖說。',page:1},
 {id:'t1',type:'table',num:'1',head:[['Wide column heading '.repeat(8),'Second column']],rows:[['Wide long value '.repeat(12),'Another value']],caption_en:'Table sample',caption_zh:'測試表格',page:1},
 ...Array.from({length:12},(_,i)=>({id:'p'+(i+2),type:'para',en:('Paragraph '+i+' with enough content to wrap correctly. ').repeat(5),zh:('第'+i+'段中文字用於排版與換行驗證。').repeat(5),page:1}))];
write('paper',{meta:{title_en:'Integration fixture',title_zh:'整合測試',page_count:1,pages:[{n:1,img:'pages/page.png',width:800,height:1000}]},blocks});
write('reader',{schema:2,rev:0,notes:{n1:{id:'n1',anchor:'p1',key:'p1',kind:'note',body:'保留筆記',quote:'中文段落',unmarked:true,color:'green',lang:'zh'},n2:{id:'n2',anchor:'p2',key:'p2',kind:'note',body:'另一張筆記',unmarked:true}},edits:{},progress:{}});
write('item',{added:new Date().toISOString(),tags:[],status:'unread'});write('layout',{p1:{page:1,box:[.1,.1,.9,.2],regions:[{page:1,box:[.1,.1,.45,.2]},{page:1,box:[.55,.1,.9,.2]}],src:'text'}});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({engine:'none',check_updates:false}));
const server=spawn(path.join(root,'.venv','Scripts','python.exe'),['-m','easyread','serve','--port','0'],{cwd:root,env:{...process.env,EASYREAD_HOME:home,EASYREAD_LIBRARY:lib,PYTHONUTF8:'1'}});
let log='';server.stderr.on('data',d=>log+=d);
(async()=>{let browser;try{
 const url=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout '+log)),20000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/[\d.:]+/);if(m){clearTimeout(t);resolve(m[0]);}});});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/update*',r=>r.fulfill({json:{current:'1.2.9',enabled:false,failed:false,newer:false}}));
 await page.goto(url+'/read/fixture');await page.waitForSelector('#b-p1 .zh');
 await page.click('[data-mode="zh"]');await page.evaluate(()=>PR.setPref('comparePrimary','en',true));
 await page.keyboard.press('Control+f');await page.locator('.find-panel input').fill('Hiddenkeyword');
 await page.waitForFunction(()=>PR.prefs.mode==='bi');
 assert.equal(await page.locator('.find-count').innerText(),'1 / 1');
 await page.evaluate(()=>PR.bumpFont(1));await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>PR.prefs.mode),'zh');assert.equal(await page.evaluate(()=>PR.prefs.comparePrimary),'en');
 assert.equal(await page.evaluate(()=>PR.ls.get('easyread-prefs',{}).mode),'zh');
 console.log('PASS hidden original search, temporary bilingual, close restores mode and font-change preserves original preference');
 const copied=await page.evaluate(()=>{const el=document.querySelector('#b-p1 .zh'),r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));getSelection().removeAllRanges();return data.getData('text/plain');});
 assert.match(copied,/\$x\^2 \+ y\^2\$/);assert.ok(copied.includes('中文段落'));
 console.log('PASS formula clipboard retains TeX without glyph-per-line output');
 await page.evaluate(()=>{PR.toggleNotesPanel(true);});await page.waitForSelector('#notespanel .card[data-note="n1"]');
 let card=page.locator('#notespanel .card[data-note="n1"]');
 await card.locator('.body').click();assert.equal(await card.locator('textarea').count(),0);
 await card.locator('[data-a="edit"]').click();await card.locator('textarea').fill('立即切換也要儲存');
 await page.locator('#notespanel .card[data-note="n2"] [data-a="edit"]').click();
 await page.waitForFunction(()=>PR.state.reader.notes.n1.body==='立即切換也要儲存');
 await page.keyboard.press('Escape');
 await card.locator('[data-note-media="add"]').click();await page.waitForSelector('.media-picker');
 await page.locator('[data-pick-media="f1"]').click();
 await page.waitForSelector('#notespanel [data-media-note="n1"] [data-note-media="toggle"]');
 assert.equal(await card.locator('.note-media-detail').count(),0);
 await card.locator('[data-note-media="toggle"]').click();assert.equal(await card.locator('.note-media-detail img').count(),1);
 await card.locator('[data-note-media="rename"]').click();await card.locator('.note-media-name-input').fill('重新命名圖片');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>PR.state.reader.notes.n1.media_refs[0].title==='重新命名圖片');
 assert.equal(await page.locator('#paper mark[data-note="n1"]').count(),0);
 await page.waitForFunction(()=>PR.store.status==='saved');await page.reload();await page.waitForSelector('#b-p1');
 await page.evaluate(()=>PR.toggleNotesPanel(true));await page.waitForSelector('#notespanel [data-media-id="f1"]');
 assert.equal(JSON.parse(fs.readFileSync(path.join(room,'reader.json'))).notes.n1.body,'立即切換也要儲存');
 assert.equal(JSON.parse(fs.readFileSync(path.join(room,'reader.json'))).notes.n1.unmarked,true);
 console.log('PASS note card navigation, explicit edit, immediate card switch saves, picker/collapse/rename/reload without reviving cancelled marks');
 // Real DOM drag/drop uses a distinct MIME, never the panel divider pointer.
 await page.evaluate(()=>{const dt=new DataTransfer();const source=document.querySelector('#b-t1 .tbl-wrap'),target=document.querySelector('#notespanel .card[data-note="n2"]');source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));});
 await page.waitForFunction(()=>PR.state.reader.notes.n2.media_refs?.[0].id==='t1');
 const mediaOnly=await page.evaluate(()=>{const n=PR.startNote({anchor:'p2'});PR.noteMedia.attach(n.id,PR.blockById.f1);PR.finishPanelNote();PR.renderNotesPanel();return n.id;});
 await page.waitForFunction(id=>!PR.state.reader.notes[id].deleted&&PR.state.reader.notes[id].media_refs.length===1,mediaOnly);
 await page.waitForFunction(()=>PR.store.status==='saved');
 console.log('PASS figure/table drag onto note and media-only note survives closing editor');
 const sides=['pages','notes','chat'];let dragged;
 for(const side of sides){
  await page.evaluate(async s=>{if(s==='pages')PR.togglePages(true);else if(s==='notes')PR.toggleNotesPanel(true);else await PR.chatAsk({});},side);await page.waitForSelector('#sideResize:not([hidden])');
  const id={pages:'pageview',notes:'notespanel',chat:'chatpanel'}[side];
  if(!dragged){const grip=await page.locator('#sideResize').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+120);await page.mouse.down();await page.mouse.move(490,grip.y+120,{steps:12});await page.mouse.up();dragged=await page.locator('#'+id).evaluate(e=>e.getBoundingClientRect().width);}
  assert.ok(Math.abs((await page.locator('#'+id).evaluate(e=>e.getBoundingClientRect().width))-dragged)<3);
  const widths=await page.evaluate(()=>({stage:document.querySelector('#stage').getBoundingClientRect().width,doc:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  assert.ok(1440-dragged>=479);assert.ok(widths.stage>=455);assert.ok(dragged>=419);assert.ok(widths.doc<=widths.viewport+1,JSON.stringify(widths));
  if(side==='pages') {await page.waitForSelector('#pageview img');assert.ok(await page.locator('#pageview img').evaluate(e=>e.getBoundingClientRect().width<=e.closest('.pv-scroll').clientWidth));}
  if(side==='chat')await page.waitForSelector('[data-c="send"]');
 }
 const grip=await page.locator('#sideResize').boundingBox();await page.mouse.dblclick(grip.x+grip.width/2,grip.y+120);
 assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--side-w')),'');
 await page.setViewportSize({width:1100,height:800});await page.waitForFunction(()=>document.querySelector('#sideResize').hidden);assert.equal(await page.locator('#chatpanel').evaluate(e=>e.getBoundingClientRect().width),600);
 await page.setViewportSize({width:1440,height:900});await page.waitForSelector('#sideResize:not([hidden])');
 await page.screenshot({path:path.join(root,'build','integration-reader.png'),fullPage:false});
 console.log('PASS splitter shared ratio in PDF/notes/chat, minimum widths, no page overflow, double-click reset and narrow overlay');
 await page.goto(url+'/');await page.waitForSelector('.row');
 const apiResult=await page.evaluate(()=>{const s={cfg:{openai:{keys_set:['url:https://a.test/v1'],custom_apis:[]}},chat:{models:[]},chatKeys:{},presets:[]};const a={base_url:'https://a.test/v1',key:'fake-a',connection_name:'API A'};PR.customApis.save(s,a,'key');PR.customApis.select(s,a,'','key');const empty=a.key;PR.customApis.save(s,{base_url:'https://b.test/v1',connection_name:'API B',key:'fake-b'},'key');return {list:PR.customApis.list(s),keys:s.chatKeys,empty};});
 assert.equal(apiResult.list.length,2);assert.equal(apiResult.empty,'');assert.equal(apiResult.keys['url:https://a.test/v1'],'fake-a');assert.equal(apiResult.keys['url:https://b.test/v1'],'fake-b');assert.equal(JSON.stringify(apiResult.list).includes('fake-'),false);
 // Exercise authenticated maintenance over HTTP through the actual page API.
 const backup=await page.evaluate(()=>PR.api('/api/p/fixture/backup',{method:'POST',body:{}}));assert.ok(backup.backup);
 const readerPath=path.join(room,'reader.json');const original=fs.readFileSync(readerPath);fs.writeFileSync(readerPath,'{broken');
 await page.reload();await page.waitForSelector('.row');await page.locator('.row').click();await page.waitForSelector('[data-maint="restore"]');
 assert.match(await page.locator('#detail').innerText(),/無法讀取|資料異常/);
 await page.evaluate(name=>PR.api('/api/p/fixture/restore-backup',{method:'POST',body:{name}}),backup.backup);
 assert.deepEqual(fs.readFileSync(readerPath),original);
 console.log('PASS endpoint profile/key separation, authenticated complete backup, visible corrupt paper and full restore');
 await page.goto(url+'/read/fixture');await page.waitForSelector('#b-p1');
 await page.evaluate(()=>{PR.token='expired-token';PR.saveNote({...PR.state.reader.notes.n2,body:'重連後保存成功'});});
 await page.waitForFunction(()=>PR.store.status==='saved'&&PR.store.pending===0);
 assert.equal(JSON.parse(fs.readFileSync(readerPath)).notes.n2.body,'重連後保存成功');
 console.log('PASS expired token reconnects and pending note is saved without reload');

 assert.deepEqual(errors,[]);console.log('PASS integration real-browser acceptance');
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);console.error(log);process.exitCode=1;});
