// Focused real-browser regression; all model responses are mocked.
const fs=require('fs'), path=require('path'), os=require('os'), assert=require('assert/strict');
const {spawn}=require('child_process');
const {chromium}=require(process.env.PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'..'), lib=fs.mkdtempSync(path.join(os.tmpdir(),'easyread-features-'));
const room=path.join(lib,'fixture'); fs.mkdirSync(room);
const write=(name,data)=>fs.writeFileSync(path.join(room,name+'.json'),JSON.stringify(data));
write('paper',{meta:{title:'Feature regression'},blocks:[
 {id:'p1',type:'para',en:'English paragraph with a selected phrase.',zh:'中文段落包含要選取的句子。',page:1},
 {id:'l1',type:'list',items:[{en:'English list item.',zh:'中文清單項目。'}],page:1},
 {id:'f1',type:'figure',caption_en:'English figure caption.',caption_zh:'中文圖片說明。',page:1}
]});
write('reader',{schema:2,rev:0,notes:{},edits:{},progress:{}});
write('item',{added:new Date().toISOString(),status:'unread',tags:[]});
const server=spawn(path.join(root,'.venv','Scripts','python.exe'),['-m','easyread','serve','--port','0'],{cwd:root,env:{...process.env,EASYREAD_LIBRARY:lib,PYTHONUTF8:'1'}});
(async()=>{
 let browser;
 try {
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),15000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/[\d.:]+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/read/fixture'); await page.waitForSelector('#b-p1 .zh');
 await page.click('[data-mode="bi"]');
 for(const [id,lang,color] of [['p1','en','green'],['l1','zh','pink'],['f1','en','blue']]){
 await page.locator('#b-'+id).scrollIntoViewIfNeeded();
 await page.evaluate(([id,lang])=>{const el=document.querySelector('#b-'+id+' .'+lang);const t=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode();const r=document.createRange();r.setStart(t,0);r.setEnd(t,Math.min(7,t.length));getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));},[id,lang]);
 await page.waitForSelector('#selbar.open');
 assert.equal(await page.locator('#selbar [data-s="en"]').count(),lang==='en'?0:1);
 await page.click('#selbar [data-color="'+color+'"]');
 await page.waitForFunction(()=>document.querySelector('.save-state').dataset.s==='saved');
 assert.equal(await page.locator('#b-'+id+' .en mark.c-'+color).count(),1);
 assert.equal(await page.locator('#b-'+id+' .zh mark.c-'+color).count(),1);
 }
 await page.click('[data-compare-menu]'); await page.click('[data-compare-primary="zh"]');
 assert.equal(await page.locator('#paper mark.hl').count(),6);
 await page.click('[data-mode="zh"]');assert.equal(await page.locator('#b-p1 .zh mark.c-green').count(),1);
 await page.reload();await page.waitForSelector('#b-p1 .zh mark.c-green');
 await page.click('[data-mode="bi"]');assert.equal(await page.locator('#paper mark.hl').count(),6);
 const notes=JSON.parse(fs.readFileSync(path.join(room,'reader.json'))).notes;
 assert.equal(Object.keys(notes).length,3);assert.equal(Object.values(notes).filter(n=>n.lang==='en').length,2);
 console.log('PASS bilingual paragraph/list/caption marks, toolbar, priority/mode switches and reload');
 await page.route('**/api/p/fixture/chat',async route=>{
 if(route.request().method()==='GET') return route.fulfill({json:{threads:[],models:[{id:'fake',label:'Fake vision',supports_images:true}],default:'fake',limits:{}}});
 const body=route.request().postDataJSON(); assert.equal(body.text,'');assert.equal(body.attachments.length,1);
 await route.fulfill({contentType:'application/x-ndjson',body:'{"thread":"mock","model":"Fake"}\n{"t":"Mock answer"}\n{"done":true,"id":"answer"}\n'});
 });
 // Open using the public reader action, exactly as the toolbar does.
 await page.evaluate(()=>PR.chatAsk({}));
 await page.waitForSelector('[data-c="attach"]');
 await page.click('[data-c="attach"]');
 const chooser=page.waitForEvent('filechooser');await page.click('[data-c="pick-images"]');
 await (await chooser).setFiles({name:'figure.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=','base64')});
 await page.waitForSelector('.ch-file.image');await page.click('[data-c="send"]');
 await page.waitForSelector('.cm.user .cm-image'); await page.waitForSelector('.cm.ai .acts');
 assert.equal(await page.locator('.cm.user .body').count(),0);
 assert.equal(await page.locator('.cm.user').innerText(),'figure.png');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS photo chooser/upload, image-only message without automatic bubble; no browser exceptions');
 await page.addInitScript(()=>{
   let state={supported:true,phase:'idle',percent:0,error:''},listener=()=>{};
   window.updateCalls={download:0,install:0};
   window.easyreadDesktop={
     updateState:async()=>state,
     onUpdateState:fn=>{listener=fn;return()=>{};},
     downloadUpdate:async()=>{window.updateCalls.download++;state={...state,phase:'downloading',percent:52};listener(state);await new Promise(r=>setTimeout(r,100));state={...state,phase:'downloaded',percent:100};listener(state);return state;},
     installUpdate:async()=>{window.updateCalls.install++;state={...state,phase:window.updateCalls.install===1?'downloaded':'installing',error:window.updateCalls.install===1?'正在翻譯，請稍後重試':''};listener(state);return state;}
   };
 });
 let failedLibrary=true;
 await page.route('**/api/library',route=>failedLibrary?route.fulfill({status:503,json:{error:'Temporary failure'}}):route.continue());
 await page.route('**/api/update*',route=>route.fulfill({json:{newer:true,latest:'1.2.9.zh-tw',current:'1.2.8',url:'https://github.com/an4131754-collab/easyread/releases/latest',notes:'Update fixture'}}));
 await page.goto(url+'/');
 await page.waitForSelector('[data-retry-library]');
 assert.equal(await page.locator('.welcome').count(),0);
 failedLibrary=false;await page.click('[data-retry-library]');await page.waitForSelector('.row');
 await page.evaluate(async()=>{await PR.checkUpdate(true);PR.openUpdate();});
 await page.click('[data-up="install"]');
 await page.waitForSelector('.update-progress');
 assert.equal(await page.locator('[data-up="install"]').isDisabled(),true);
 await page.waitForSelector('.update-error');
 assert.match(await page.locator('.update-error').innerText(),/正在翻譯/);
 assert.equal(await page.locator('[data-up="install"]').innerText(),'重新啟動並安裝');
 await page.click('[data-up="install"]');
 await page.waitForFunction(()=>window.updateCalls.install===2);
 assert.deepEqual(await page.evaluate(()=>window.updateCalls),{download:1,install:2});
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS library error/retry without false empty welcome; update progress, busy-backend retry and install without redownloading');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});


