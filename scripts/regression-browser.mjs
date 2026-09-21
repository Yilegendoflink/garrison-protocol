// 浏览器回归统一入口：一个脚本、多个 suite。需要先起本地服务（npm run dev → http://127.0.0.1:5502），
// 并准备 Playwright + 本地 Edge（可用 BROWSER_EXECUTABLE / PLAYWRIGHT_MODULE 覆盖）。
//
//   node scripts/regression-browser.mjs            # 全部 suite
//   node scripts/regression-browser.mjs smoke      # 只跑指定 suite（可列多个）
//   node scripts/regression-browser.mjs --list     # 列出 suite
//
// suite 一览：smoke（大厅/备战/开战/响应式/离线启动）、combat（离线开战 + 暂停恢复 + 设置持久化）、
// effects（读档恢复战斗 + 召唤物档案 + ownership 持久化）、layout（手机横屏布局）、
// fx-preview（15 类攻击特效渲染，校验不改战斗状态）、mobile-bonds（手机盟约面板不压扁、可滚动）。
// 原来分散的 9 个脚本（browser-smoke／combat-acceptance／effects-browser／landscape-browser／fx-preview／
// mobile-bonds-browser，以及面向已退役 legacy 客户端的 deployment／benchmark／season）已合并或退役。
// 截图与报告路径保持与原脚本一致（artifacts/…），旧文档里的引用仍然有效。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const URL=process.env.REGRESSION_URL||'http://127.0.0.1:5502/';
const EDGE=process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js')).href);}
const {chromium}=pw.default||pw;

const suites=new Map();
const suite=(name,fn)=>suites.set(name,fn);

suite('wave-activities',async(browser)=>{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);
 await page.waitForFunction(()=>window.__garrisonReady);
 await page.locator('[data-act=editor]').click();
 await page.locator('[data-act=ed-tools]').click();await page.locator('[data-act=ed-defaults]').click();await page.locator('[data-act=ed-tools]').click();
 assert.equal(await page.locator('[data-act=ed-readiness]').inputValue(),'ready');
 await page.locator('[data-act=ed-activity]').selectOption('将进酒');
 const rows=page.locator('.wave-ed-table tbody tr');
 assert.ok(await rows.count()>0);
 for(const row of await rows.all())assert.match(await row.innerText(),/将进酒/);
 await page.locator('[data-act=ed-add-temp]').click();
 await page.locator('[data-act=ed-template-activity]').selectOption('将进酒');
 await page.locator('.wave-ed-table [data-act=ed-add]:enabled').first().click();
 assert.match(await page.locator('.wave-ed-pool').innerText(),/将进酒/);
 assert.equal(await page.locator('[data-act=ed-template-activity]').isDisabled(),false);
 await page.locator('[data-act=ed-activity]').selectOption('初始');
 assert.ok(await page.locator('.wave-ed-table [data-act=ed-add]:enabled').count()>0);
 const added=await page.locator('.wave-ed-table [data-act=ed-add]:enabled').first().getAttribute('data-id');
 await page.locator('.wave-ed-table [data-act=ed-add]:enabled').first().click();
 assert.equal(await page.locator('.wave-ed-cards article').count(),2);
 await page.locator('.wave-ed-cards [data-act=ed-remove][data-id="'+added+'"]').click();
 await page.locator('[data-act=ed-readiness]').selectOption('pending');
 for(const row of await rows.all())assert.match(await row.innerText(),/待补齐/);
 assert.equal(await page.locator('#wave-ed-test').count(),0);
 const selectedName=await page.locator('.wave-ed-current h2').innerText();
 const selectedEnemy=await page.locator('.wave-ed-cards .wave-ed-card b').first().innerText();
 await page.locator('.wave-ed-current [data-act=ed-roll]').click();
 const dialog=page.locator('#wave-ed-test');await dialog.waitFor({state:'visible'});
 assert.equal(await dialog.locator('h2').innerText(),selectedName);
 assert.equal(await dialog.locator('.wave-ed-test-results li').count(),1);
 assert.equal(await dialog.locator('.wave-ed-test-results b').innerText(),selectedEnemy);
 await dialog.locator('[data-act=ed-roll]').click();
 assert.equal(await page.locator('#wave-ed-test h2').innerText(),selectedName);
 await fs.mkdir('artifacts/wave-activities',{recursive:true});
 await page.screenshot({path:'artifacts/wave-activities/test-dialog.png',fullPage:true});
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#wave-ed-test').count(),0);
 assert.equal(await page.locator('.wave-ed-current [data-act=ed-roll]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-act=ed-activity]').selectOption('all');
 await page.locator('[data-act=ed-readiness]').selectOption('ready');
 await page.locator('[data-act=ed-temp][data-index="0"]').click();
 await page.locator('[data-act=ed-filters]').click();
 assert.equal(await page.locator('#ed-motion').isVisible(),true);
 await page.locator('#ed-search').fill('初始');
 assert.equal(await page.locator('#ed-motion').isVisible(),true);
 await page.locator('#ed-search').fill('');
 await page.locator('[data-act=ed-filters]').click();
 await page.locator('[data-act=ed-tier][data-tier="2"]').click();
 assert.ok(await page.locator('.wave-ed-cards article').count()>=4);
 await page.locator('.wave-ed-current [data-act=ed-roll]').click();
 assert.ok(await page.locator('#wave-ed-test .wave-ed-test-results li').count()>=4);
 await page.locator('[data-act=ed-close-test]').click();
 await page.screenshot({path:'artifacts/wave-activities/editor.png',fullPage:true});
 for(const width of [320,375,414,768]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面不得横向溢出 '+width);
  await page.locator('.wave-ed-current [data-act=ed-roll]').click();
  const bounds=await page.locator('#wave-ed-test').boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await page.locator('[data-act=ed-close-test]').click();
  assert.equal(await page.locator('#wave-ed-test').count(),0);
  await page.screenshot({path:'artifacts/wave-activities/editor-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);await page.close();
});

// ── smoke｜原 scripts/browser-smoke.cjs ───────────────────────────────
suite("smoke",async(browser)=>{
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('artifacts/s0-s3',{recursive:true});
 await page.goto('http://127.0.0.1:5502/');await page.waitForFunction(()=>window.__garrisonReady===true);assert.match(await page.locator('body').innerText(),/卫戍协议/);await page.screenshot({path:'artifacts/s0-s3/lobby.png'});
 await page.locator('[data-act=limits]').click();assert.ok(await page.locator('#native-modal').isVisible());assert.match(await page.locator('#native-modal').innerText(),/已知差异/);await page.locator('#native-modal [data-act=close]').click();
 await page.locator('[data-act=editor]').click();assert.ok(await page.locator('.wave-ed').isVisible());assert.match(await page.locator('body').innerText(),/配置管理/);await page.locator('[data-act=ed-tools]').click();await page.locator('[data-act=ed-defaults]').click();await page.locator('[data-act=ed-tools]').click();assert.match(await page.locator('body').innerText(),/模板敌人/);await page.screenshot({path:'artifacts/s0-s3/editor.png'});await page.locator('[data-act=home]').click();
 await page.locator('[data-act=sandbox]').click();assert.ok(await page.locator('.native-game.is-sandbox').isVisible());assert.ok(await page.locator('#sandbox-op-search').count());const sandboxAll=await page.locator('[data-sandbox-op]:visible').count();await page.locator('#sandbox-op-search').fill('山');assert.equal(await page.locator('[data-sandbox-op]:visible').count(),2);await page.locator('#sandbox-op-search').fill('');assert.equal(await page.locator('[data-sandbox-op]:visible').count(),sandboxAll);await page.locator('[data-act=sandbox-add-op]').first().click();const sandboxCanvas=page.locator('#native-canvas'),sandboxRect=await sandboxCanvas.boundingBox();assert.ok(sandboxRect);await page.mouse.click(sandboxRect.x+sandboxRect.width*.35,sandboxRect.y+sandboxRect.height*.25);await page.locator('.native-facing').waitFor({state:'visible'});await page.locator('.native-facing [data-act=aim][data-dir="0"]').click();await page.locator('.native-facing [data-act=place-confirm]').click();await page.locator('[data-act=sandbox-add-dummy]').click();assert.match(await page.locator('.sandbox-inline-picked').innerText(),/不行动木桩/);await page.locator('.native-controls [data-act=sandbox-start]').click();assert.ok(await page.locator('.native-game.is-sandbox.is-battle').isVisible());assert.match(await page.locator('#native-wave-progress').innerText(),/击倒 0 \/ 1/);await page.locator('[data-act=sandbox-fill-sp]').first().click();await page.locator('[data-act=sandbox-skill]').first().click();await page.locator('[data-act=sandbox-step]').click();await page.locator('[data-act=sandbox-reset]').click();assert.ok(await page.locator('.native-game.is-sandbox').isVisible());assert.ok(await page.locator('#sandbox-op-search').count());await page.locator('[data-act=sandbox-exit]').click();assert.ok(await page.locator('.native-lobby').isVisible());
 await page.locator('[data-act=new]').click();assert.match(await page.locator('body').innerText(),/战前准备/);await page.locator('[data-act=begin]').click();assert.ok(await page.locator('.native-game').isVisible());
 const buy=page.locator('[data-act=buy]').first();await buy.click();await buy.click();assert.equal(await page.locator('.native-bench [data-act=select]').count(),1);const handUnit=page.locator('.native-bench [data-act=select]').first();await handUnit.click();assert.equal(await page.locator('.native-dossier').count(),1);await page.locator('[data-act=inspect-close]').click();assert.equal(await page.locator('.native-dossier').count(),0);await handUnit.click();assert.equal(await page.locator('.native-dossier').count(),1);await page.locator('[data-act=limits]').click();assert.equal(await page.locator('.native-dossier').count(),0);assert.equal(await page.locator('#native-modal').count(),0);await page.waitForTimeout(550);const canvas=page.locator('#native-canvas');await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();assert.ok(rect);await page.mouse.click(rect.x+rect.width*.35,rect.y+rect.height*.25);await page.locator('.native-facing').waitFor({state:'visible'});await page.locator('.native-facing [data-act=aim][data-dir="0"]').click();await page.locator('.native-facing [data-act=place-confirm]').click();assert.match(await page.locator('#native-wave-progress').innerText(),/1 \/ 8/);await page.screenshot({path:'artifacts/s0-s3/prep.png'});
 await page.locator('[data-act=start]').click();await page.waitForFunction(()=>document.querySelector('.native-game')?.classList.contains('is-battle'));await page.waitForTimeout(250);assert.match(await page.locator('#native-status').innerText(),/费用|秒/);await page.screenshot({path:'artifacts/s0-s3/combat.png'});
 await page.locator('[data-act=pause]').click();assert.match(await page.locator('[data-act=pause]').innerText(),/继续/);await page.locator('[data-act=pause]').click();
 await page.locator('[data-act=home]').click();assert.ok(await page.locator('[data-act=resume]').count()>=1);await page.reload();await page.waitForFunction(()=>window.__garrisonReady===true);assert.equal(await page.locator('[data-act=resume]').count(),1);
 const responsive=[];for(const width of [320,375,414,768]){await page.setViewportSize({width,height:850});await page.locator('[data-act=editor]').click();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);responsive.push({width,overflow});assert.equal(overflow,false,'no root overflow '+width);await page.screenshot({path:'artifacts/s0-s3/mobile-'+width+'.png'});await page.locator('[data-act=home]').click();}
 const offline=await browser.newPage();await offline.goto(pathToFileURL(path.resolve('dist/index.html')).href);await offline.waitForFunction(()=>window.__garrisonReady===true);assert.match(await offline.locator('body').innerText(),/卫戍协议/);
 assert.deepEqual(errors,[]);const report={passed:true,desktop:['lobby','limitations','wave-editor-defaults','briefing','buy','deploy','start','pause','resume-after-reload'],responsive,offlineFileLaunch:true,errors};await fs.writeFile('artifacts/s0-s3/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});

// ── combat｜原 scripts/combat-acceptance.cjs ───────────────────────────────
suite("combat",async(browser)=>{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const now=Date.now();Date.now=()=>now;});
  await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);await page.waitForFunction(()=>window.__garrisonReady);
  await page.locator('[data-act=new]').click();await page.locator('[data-act=begin]').click();
  await page.locator('[data-act=buy]').first().click();await page.locator('[data-act=buy]').first().click();await page.locator('.native-bench [data-act=select]').first().click();
  const cv=page.locator('canvas');let placed=false;
  for(const y of [.5,.65,.35]){for(const x of [.3,.4,.5,.6]){const r=await cv.boundingBox();await cv.click({position:{x:r.width*x,y:r.height*y}});if(await page.locator('.native-facing').isVisible()){await page.locator('[data-act=aim][data-dir="0"]').click();await page.locator('[data-act=place-confirm]').click();placed=true;break;}}if(placed)break;}
  assert.ok(placed);await page.locator('[data-act=start]').click();await page.waitForSelector('.is-battle');assert.equal(await page.locator('.native-shop').isVisible(),false);
  await page.locator('[data-act=pause]').click();await page.waitForTimeout(300);const frozen=await cv.screenshot();await page.waitForTimeout(350);assert.ok(frozen.equals(await cv.screenshot()),'paused canvas must be identical');
  await page.locator('#native-volume').fill('0.35');await page.locator('#native-volume').dispatchEvent('input');assert.equal(await page.evaluate(()=>localStorage.getItem('garrison-volume')),'0.35');
  await page.locator('[data-act=reduce-fx]').click();await page.locator('[data-act=mute]').click();await page.locator('[data-act=speed][data-speed="4"]').click();assert.ok((await page.locator('[data-act=speed][data-speed="4"]').getAttribute('class')).includes('chosen'));
  await page.locator('[data-act=pause]').click();await page.waitForTimeout(1600);assert.equal((await cv.screenshot()).equals(frozen),false,'battle resumes');
  await page.locator('[data-act=pause]').click();await cv.scrollIntoViewIfNeeded();await fs.mkdir('artifacts/combat-acceptance',{recursive:true});await page.screenshot({path:'artifacts/combat-acceptance/battle.png',fullPage:true});
  assert.deepEqual(errors,[]);const report={passed:true,checks:['offline launch','buy and deploy','battle layout','paused canvas frozen','volume persisted','mute and reduced effects','4x selection','resume simulation'],errors};await fs.writeFile('artifacts/combat-acceptance/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});

// ── effects｜原 scripts/effects-browser.cjs ───────────────────────────────
suite("effects",async(browser)=>{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);await page.waitForFunction(()=>window.__garrisonReady);
  await page.evaluate(s=>localStorage.setItem('garrison-native-manual-v1',JSON.stringify(s)),snapshot);await page.reload();await page.waitForFunction(()=>window.__garrisonReady);await page.locator('[data-act=resume]').click();
  const cv=page.locator('canvas');await cv.scrollIntoViewIfNeeded();const r=await cv.boundingBox(),v=g.map.viewport,cols=v.right-v.left+1,rows=v.bottom-v.top+1,tw=Math.min((r.width-32)/cols,(r.height-44)/rows/.82),th=tw*.82,ox=(r.width-tw*cols)/2-v.left*tw,oy=(r.height-th*rows)/2-v.top*th;
  await cv.click({position:{x:ox+(token.x+.5)*tw,y:oy+(token.y+.5)*th-10}});
  assert.match(await page.locator('.native-dossier').innerText(),/医疗探机/);
  await page.locator('[data-act=inspect-close]').click();await page.locator('[data-act=pause]').click();await page.waitForTimeout(2200);await page.locator('[data-act=pause]').click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('garrison-native-manual-v1')));assert.ok(after.battle.time>0);assert.equal(after.battle.summons[0].ownerUid,token.ownerUid);
  await fs.mkdir('artifacts/public-capabilities',{recursive:true});await page.screenshot({path:'artifacts/public-capabilities/summons.png',fullPage:true});assert.deepEqual(errors,[]);
  const report={passed:true,checks:['restore battle without deployment replay','select summon dossier','resume simulation','persist summon ownership'],errors};await fs.writeFile('artifacts/public-capabilities/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});

suite('mine-camp',async(browser)=>{
 const {NATIVE_DATA}=await import('../dist/runtime-data.js'),{NativeSession}=await import('../dist/native-session.js'),{applyStatus}=await import('../dist/status.js');
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1000;for(const u of b.s.units){applyStatus(u,'disarm',600);applyStatus(u,'skillLock',600);}
 b.spawn({id:'enemy_1251_lysyta'},{x:8,y:5,route:[{kind:'wait',x:8,y:5,time:600}],cmd:0});b.s.enemies[0].canAttack=false;b.s.enemies[0].hp=b.s.enemies[0].maxHp=1e9;
 const camp=b.spawnMineCamp({x:3,y:3,route:[{kind:'move',x:3,y:3},{kind:'move',x:7,y:3},{kind:'wait',x:7,y:3,time:600}]});for(let i=0;i<453;i++)b.step();assert.equal(camp.sp,15);
 const snapshot=g.snapshot(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);await page.waitForFunction(()=>window.__garrisonReady);
 await page.evaluate(s=>{localStorage.removeItem('garrison-native-safe-v1');localStorage.setItem('garrison-native-manual-v1',JSON.stringify(s));},snapshot);await page.reload();await page.waitForFunction(()=>window.__garrisonReady);await page.locator('[data-act=resume]').click();
 const cv=page.locator('#native-canvas');await cv.scrollIntoViewIfNeeded();const r=await cv.boundingBox(),v=g.map.viewport,cols=v.right-v.left+1,rows=v.bottom-v.top+1,tw=Math.min((r.width-32)/cols,(r.height-44)/rows/.82),th=tw*.82,ox=(r.width-tw*cols)/2-v.left*tw,oy=(r.height-th*rows)/2-v.top*th;
 await cv.click({position:{x:ox+(camp.x+.5)*tw,y:oy+(camp.y+.5)*th-10}});assert.match(await page.locator('.native-dossier').innerText(),/隐蔽矿道/);const command=page.locator('[data-act=mineCommand]');assert.equal(await command.isEnabled(),true);await command.click();assert.match(await page.locator('#native-mine-camp-controls').innerText(),/当前指令：出击/);assert.equal(await page.locator('[data-act=mineCommand]').isDisabled(),true);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('garrison-native-manual-v1')));assert.equal(after.battle.summons.find(s=>s.type==='mine-camp').mineMode,'dispatch');assert.ok(after.battle.summons.filter(s=>s.type==='neutral-miner').every(s=>!s.waiting));assert.deepEqual(errors,[]);
 await fs.mkdir('artifacts/enemy-behavior',{recursive:true});await page.screenshot({path:'artifacts/enemy-behavior/mine-camp.png'});console.log(JSON.stringify({passed:true,checks:['restore camp and miner','open device dossier','dispatch command','sp spent','persist released miners'],errors}));
});

// ── layout｜原 scripts/landscape-browser.cjs ───────────────────────────────
suite("layout",async(browser)=>{
const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('artifacts/landscape',{recursive:true});
 await page.goto('http://127.0.0.1:5502');await page.waitForFunction(()=>window.__garrisonReady);await page.locator('[data-act=new]').tap();await page.screenshot({path:'artifacts/landscape/briefing.png'});await page.locator('[data-act=begin]').tap();
 const results=[];
 for(const [width,height] of [[844,390],[667,375],[568,320],[932,430]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);const dims=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()}));results.push(dims);assert.ok(dims.scrollWidth<=width+1,JSON.stringify(dims));assert.ok(dims.scrollHeight<=height+1,JSON.stringify(dims));for(const selector of ['[data-act=start]','[data-act=refresh]','.native-shop-cards button:last-child']){const r=await page.locator(selector).boundingBox();assert.ok(r&&r.x>=0&&r.y+r.height<=height+1,selector);}const hand=await page.locator('.native-bench').boundingBox(),shop=await page.locator('.native-shop').boundingBox();assert.ok(hand.y+hand.height<=shop.y+1,'hand stays above shop');const label=await page.locator('.native-bench-label').boundingBox();assert.ok(dims.canvas.bottom<=label.y+1,'reserve must not cover battlefield');assert.ok(dims.canvas.width>=width-1,'battlefield uses full width');const boardClip={x:100,y:60,width:width-260,height:dims.canvas.height-60},boardBefore=await page.screenshot({clip:boardClip});assert.ok(await page.locator('[data-act=start]').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'start button unobstructed');await page.locator('[data-act=supply-toggle]').tap();assert.equal(await page.locator('[data-act=supply-toggle]').getAttribute('aria-expanded'),'false');assert.ok(!(await page.locator('.native-shop-cards').isVisible()));assert.ok(await page.locator('.native-shop h2').isVisible());assert.equal(await page.locator('.native-shop [data-act=supply-toggle]').count(),1);assert.ok(await page.locator('.native-bench').isVisible(),'reserve stays visible');assert.ok(await page.locator('.native-bench-label').isVisible());const reserve=await page.locator('.native-bench').boundingBox();assert.ok(reserve.y+reserve.height<=height+1);assert.match(await page.locator('.native-bench-label').innerText(),/^整备区/);const closedCanvas=await page.locator('canvas').boundingBox(),closedLabel=await page.locator('.native-bench-label').boundingBox();assert.ok(closedCanvas.y+closedCanvas.height<=closedLabel.y+1,'collapsed reserve does not cover battlefield');assert.deepEqual(await page.screenshot({clip:boardClip}),boardBefore,'board tiles do not move or shrink when toggling shop');await page.locator('[data-act=supply-toggle]').tap();await page.screenshot({path:`artifacts/landscape/prep-${width}.png`});}
 await page.setViewportSize({width:844,height:390});await page.locator('[data-act=field-info]').tap();assert.ok(await page.locator('#native-modal').isVisible());await page.locator('#native-modal [data-act=close]').tap();
 await page.locator('[data-act=buy]').first().tap();await page.locator('[data-act=buy]').first().tap();assert.equal(await page.locator('.native-bench [data-act=select]').count(),1);await page.screenshot({path:'artifacts/landscape/hand-and-shop.png'});await page.locator('[data-act=supply-toggle]').tap();assert.ok(await page.locator('.native-bench [data-act=select]').first().isVisible());await page.locator('.native-bench [data-act=select]').first().tap();await page.locator('[data-act=inspect-close]').tap();await page.screenshot({path:'artifacts/landscape/collapsed.png'});
 const point=await page.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect(),b=document.querySelector('.native-bonds').getBoundingClientRect(),c=document.querySelector('.native-controls').getBoundingClientRect(),cap=document.querySelector('.native-field-caption').getBoundingClientRect();const left=b.right+8,top=cap.bottom+8,w=c.left-left-8,h=r.height-top-8-58,tw=Math.min(w/9,h/4/.82),th=tw*.82;return {x:left+(w-tw*9)/2+tw*1.5,y:top+(h-th*4)/2+th*.5};});await page.touchscreen.tap(point.x,point.y);
 assert.ok(await page.locator('.native-facing').isVisible(),'deployment direction selector');{await page.locator('[data-act=aim][data-dir="0"]').tap();await page.locator('[data-act=place-confirm]').tap();}
 assert.match(await page.locator('#native-wave-progress').innerText(),/1 \/ 8/);await page.locator('[data-act=start]').tap();await page.waitForSelector('.native-game.is-battle');assert.ok(await page.locator('#native-cost-balance').isVisible());const firstCost=await page.locator('#native-cost-balance').innerText();assert.ok(Number.isFinite(Number(firstCost)));await page.waitForFunction(previous=>document.querySelector('#native-cost-balance').textContent!==previous,firstCost,{timeout:6000});await page.locator('[data-act=pause]').tap();assert.ok(await page.locator('.native-bench').isVisible(),'reserve visible during battle');await page.screenshot({path:'artifacts/landscape/battle.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:900});assert.ok(await page.locator('.native-detail').isVisible());assert.ok(await page.locator('#native-cost-balance').isVisible());await page.screenshot({path:'artifacts/landscape/desktop-cost.png'});assert.deepEqual(errors,[]);await fs.writeFile('artifacts/landscape/report.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results));
});

// ── fx-preview｜原 scripts/fx-preview.cjs ───────────────────────────────
suite("fx-preview",async(browser)=>{
const page=await browser.newPage({viewport:{width:1200,height:1250}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>body{margin:0;background:#101d23;color:#dceee8;font:16px sans-serif}h1{font-size:24px;margin:24px}#grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:0 24px}section{border:1px solid #38505b;background:#162730}h2{font-size:15px;margin:12px}canvas{width:100%;height:180px}</style><h1>攻击特效分类 · 实际渲染器预览</h1><div id="grid"></div>');
  const source=await fs.readFile('dist/native-fx.js','utf8');await page.addScriptTag({content:source.replace(/^export /gm,'')+'\nwindow.previewDraw=drawFx;'});
  await page.evaluate(()=>{
   const cases=[['挥砍',{branch:'sword'}],['突刺',{branch:'instructor'}],['重击',{branch:'fighter'}],['群体挥扫',{style:'block-count',many:true}],['散射',{branch:'reaperrange',ranged:true,many:true}],['范围术式',{style:'all',ranged:true,many:true,type:'arts'}],['链式法术',{chain:true}],['治疗连接',{heal:true}],['炮击与爆炸',{artillery:true}],['独立余震',{aftershock:true}],['回旋弹体',{returns:true}],['浮游单元与储能',{drone:true}],['持续回复领域',{regen:true}],['装填与弹仓',{magazine:true}],['敌方远程攻击',{enemy:true,ranged:true}]];
   for(const [title,config]of cases){const section=document.createElement('section');section.innerHTML='<h2>'+title+'</h2><canvas width="350" height="180"></canvas>';document.querySelector('#grid').append(section);const c=section.querySelector('canvas').getContext('2d'),point=(x,y)=>({x:35+x*60,y:90+y*45}),u={uid:1,x:0,y:0,deployed:true,hp:100,energy:3,magazine:4,action:{kind:'reload'}},enemies=[{uid:2,x:3,y:0,hp:100},{uid:3,x:4,y:-.7,hp:100},{uid:4,x:4,y:.7,hp:100}],s={time:1,units:[u],enemies,events:[],projectiles:[],effects:[]};
    c.strokeStyle='#30434b';for(let i=0;i<6;i++){c.strokeRect(5+i*60,65,60,45);}c.fillStyle='#88c8b7';c.fillRect(25,75,20,25);c.fillStyle='#cd8f7f';for(const e of enemies){const p=point(e.x,e.y);c.fillRect(p.x-7,p.y-12,14,22);}
    const ev=(type,extra)=>s.events.push({...extra,type,t:.9});
    if(config.chain){ev('chain',{x:3,y:0,targetX:4,targetY:-.7});ev('chain',{x:4,y:-.7,targetX:4,targetY:.7});}
    else if(config.heal){ev('heal',{x:0,y:0,targetX:3,targetY:0});ev('heal',{x:3,y:0,targetX:4,targetY:.7});}
    else if(config.artillery){s.projectiles.push({owner:1,target:2,x:1.4,y:0,startX:0,startY:0,ranged:true,style:'splash',type:'physical'});ev('impact',{x:3,y:0,radius:.8});}
    else if(config.aftershock)ev('aftershock',{x:3,y:0,radius:1});
    else if(config.returns)s.projectiles.push({owner:1,target:2,x:1.5,y:0,returns:true,type:'physical'});
    else if(config.drone)s.projectiles.push({owner:1,target:2,x:1.5,y:0,branch:'funnel',type:'arts'});
    else if(!config.regen&&!config.magazine)for(const e of config.many?enemies:enemies.slice(0,1))ev('strike',{x:0,y:0,targetX:e.x,targetY:e.y,damageType:config.type||'physical',...config});
    const b={s,behavior:()=>({drone:config.drone,storage:config.drone,magazine:config.magazine,kind:config.regen?'regeneration':'damage'}),skillActive:()=>false,range:()=>[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}]};
    const before=JSON.stringify(s);window.previewDraw(c,point,{tw:60,th:45,r:{width:350,height:180}},b);if(JSON.stringify(s)!==before)throw Error('Renderer mutated battle');
   }
  });
  assert.deepEqual(errors,[]);await fs.mkdir('artifacts/fx-preview',{recursive:true});await page.screenshot({path:'artifacts/fx-preview/categories.png',fullPage:true});console.log('15 visual categories rendered; no state mutation or browser errors');
});

// ── mobile-bonds｜原 scripts/mobile-bonds-browser.mjs ─────────────────────────
suite('mobile-bonds',async(browser)=>{
 const OUT='artifacts/mobile-bonds';await fs.mkdir(OUT,{recursive:true});
const ANDROID='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function openGame(opts){
 const ctx=await browser.newContext(opts);
 const page=await ctx.newPage();
 await page.goto(URL);
 await page.waitForFunction(()=>window.__garrisonReady===true);
 await page.locator('[data-act=new]').click();
 await page.locator('[data-act=begin]').click();
 await page.waitForSelector('.native-game .native-bonds');
 return {ctx,page};
}

const ROWS=n=>Array.from({length:n},(_,i)=>`<button data-act="bond-info" data-id="probe${i}" class="${i%3===0?'active':''}"><b>盟约${i}</b><span>${i} / 6</span><small>${i} 层</small></button>`).join('');

// 全部用布局盒模型（offsetTop/offsetHeight/clientHeight/scrollHeight）测量：
// 手机竖屏会被 CSS transform 旋转，用 getBoundingClientRect 会得到屏幕坐标而误判重叠。
async function measure(page,label,{rows=20}={}){
 const r=await page.evaluate(({rows})=>{
  const panel=document.querySelector('.native-bonds');
  panel.innerHTML=rows;
  const btns=[...panel.querySelectorAll('button')];
  const axis=getComputedStyle(panel).flexDirection==='column'?'column':'row';
  const rects=btns.map(b=>({top:b.offsetTop,height:b.offsetHeight,left:b.offsetLeft,width:b.offsetWidth}));
  let overlap=0;
  const gaps=[];
  for(let i=1;i<rects.length;i++){
   if(axis==='column'){gaps.push(rects[i].top-(rects[i-1].top+rects[i-1].height));if(rects[i].top<rects[i-1].top+rects[i-1].height-0.5)overlap++;}
   else{gaps.push(rects[i].left-(rects[i-1].left+rects[i-1].width));if(rects[i].left<rects[i-1].left+rects[i-1].width-0.5)overlap++;}
  }
  // 卡片被压扁的症状：内容比卡片自身高/宽，文字挤在一起（<button> 会裁掉溢出内容）
  const clipped=btns.filter(b=>b.scrollHeight>b.clientHeight+1||b.scrollWidth>b.clientWidth+1).length;
  return {landscapeUi:document.documentElement.classList.contains('native-landscape-ui'),
   rotate:document.documentElement.classList.contains('native-need-rotate'),
   coarse:matchMedia('(hover:none) and (pointer:coarse)').matches,axis,buttons:btns.length,
   panelH:panel.clientHeight,panelScrollH:panel.scrollHeight,scrollable:panel.scrollHeight>panel.clientHeight+1,
   overlap,clipped,contentH:Math.max(...btns.map(b=>b.scrollHeight)),cardH:rects[0]?.height,gap:gaps[0],
   flex:getComputedStyle(btns[0]).flex,overflowY:getComputedStyle(panel).overflowY};
 },{rows:ROWS(rows)});
 return {...r,label};
}

// ① 手机横屏：左侧盟约竖列（用户报的那一屏）
{
 const {ctx,page}=await openGame({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:ANDROID});
 const fixed=await measure(page,'横屏·当前CSS');
 await page.locator('.native-bonds').screenshot({path:OUT+'/panel-fixed.png'});
 await page.screenshot({path:OUT+'/landscape.png'});
 await page.addStyleTag({content:'.native-bonds button{flex:0 1 auto!important}'});   // 复现旧规则：允许 flex 压扁
 const old=await measure(page,'横屏·旧规则(允许压扁)');
 await page.locator('.native-bonds').screenshot({path:OUT+'/panel-squashed.png'});
 results.push(fixed,old);
 await ctx.close();
}
// ② 手机竖屏（Android 会被转成横屏 UI：native-need-rotate）
{
 const {ctx,page}=await openGame({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:ANDROID});
 results.push(await measure(page,'竖屏·旋转后的横屏UI'));
 await ctx.close();
}
// ③ iPhone 竖屏：不锁横屏，走 max-width:600px 的横向条
{
 const {ctx,page}=await openGame({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:IPHONE});
 results.push(await measure(page,'iPhone竖屏·横向条'));
 await page.screenshot({path:OUT+'/iphone-portrait.png'});
 await ctx.close();
}
await fs.writeFile(OUT+'/report.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
const [landscapeFixed,landscapeOld,portraitRotated,iphone]=results;
const fail=[];
if(!landscapeFixed.landscapeUi||landscapeFixed.axis!=='column')fail.push('横屏没有进入左侧竖列布局，模拟无效');
if(landscapeFixed.overlap!==0)fail.push('横屏当前 CSS 卡片重叠：'+landscapeFixed.overlap);
if(landscapeFixed.clipped!==0)fail.push('横屏当前 CSS 文字被压扁裁切：'+landscapeFixed.clipped);
if(!landscapeFixed.scrollable)fail.push('横屏盟约面板不可上下滚动');
if(landscapeFixed.cardH<landscapeFixed.contentH)fail.push('横屏卡片高度小于内容高度');
if(landscapeOld.clipped===0)fail.push('旧规则对照组没有复现压扁，说明本次改动不是关键变量');
if(portraitRotated.clipped!==0||portraitRotated.overlap!==0)fail.push('竖屏(旋转)有压扁/重叠');
if(iphone.clipped!==0||iphone.overlap!==0)fail.push('iPhone竖屏横向条有压扁/重叠');
console.log(fail.length?('FAIL\n'+fail.join('\n')):'PASS');
if(fail.length)throw Error('mobile-bonds 失败：\n'+fail.join('\n'));
});

// 结算必须在系统/游戏减动效及完全禁用 CSS 动画时仍然可见、可操作。
suite('round-end',async(browser)=>{
 const source=await fs.readFile('dist/native.bundle.js','utf8');
 const marker="root.setAttribute('data-view','native');";
 assert.ok(source.includes(marker));
 const instrumented=source.replace(marker,"window.__roundEndTest={state,render,roundEndBegin};"+marker);
 for(const mode of ['normal','system-reduced','game-reduced','animations-disabled','animations-paused']){
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:mode==='system-reduced'?'reduce':'no-preference'}),errors=[];
  try{
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/native.bundle.js*',route=>route.fulfill({contentType:'application/javascript',body:instrumented}));
   await page.goto(URL);await page.waitForFunction(()=>window.__garrisonReady);
   await page.locator('[data-act=new]').click();await page.locator('[data-act=begin]').click();
   if(mode==='animations-disabled')await page.addStyleTag({content:'*{animation:none!important;transition:none!important}'});
   if(mode==='animations-paused')await page.addStyleTag({content:'.native-round-end *{animation-play-state:paused!important}'});
   for(const loss of [10,0]){
    const intro=await page.evaluate(({mode,loss})=>{
     const {state,render,roundEndBegin}=window.__roundEndTest,g=state.game;
     state.reduceFx=mode==='game-reduced';g.s.phase='intermission';g.s.lastBattle={loss,leaks:loss};
     render();roundEndBegin(g);
     const style=selector=>getComputedStyle(document.querySelector(selector)).opacity;
     return {banner:style('.native-round-end-banner'),wave:style('.native-round-end-wave'),english:style('.native-round-end-wave em')};
    },{mode,loss});
    if(mode==='system-reduced'||mode==='animations-disabled')assert.deepEqual(intro,{banner:'1',wave:'1',english:'1'},mode+'：禁用动画时波次横幅仍应显示');
    await page.waitForFunction(loss=>{
     const layer=document.querySelector('.native-round-end');
     return layer?.dataset.stage==='count'&&(!loss||layer.querySelector('.native-round-end-value')?.textContent===String(loss));
    },loss);
    const visible=await page.evaluate(()=>{
     const banner=document.querySelector('.native-round-end-banner'),body=banner.querySelector('.native-round-end-body'),button=body.querySelector('button'),r=button.getBoundingClientRect();
     return {banner:getComputedStyle(banner).opacity,body:getComputedStyle(body).opacity,width:r.width,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    });
    assert.equal(visible.banner,'1',mode+'：结算横幅可见');
    // 等待普通模式下正文的透明度过渡结束，避免在过渡首帧取样。
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.native-round-end-body')).opacity==='1');
    assert.ok(visible.width>=190&&visible.hit,mode+'：按钮未缩扁且可点击');
    if(!loss)assert.equal(await page.locator('.native-round-end-perfect').innerText(),'完美通关');
    await page.locator('.native-round-end [data-act=next]').click();
    assert.equal(await page.locator('.native-round-end').count(),0);
    assert.notEqual(await page.evaluate(()=>window.__roundEndTest.state.game.s.phase),'intermission');
   }
   assert.deepEqual(errors,[],mode);
  }finally{await page.close();}
 }
});

suite('round-end-flow',async(browser)=>{
 const source=await fs.readFile('dist/native.bundle.js','utf8'),marker="root.setAttribute('data-view','native');";
 assert.ok(source.includes(marker));
 const instrumented=source.replace(marker,"window.__roundEndFlow={state,render,buildPhasePlan,data};"+marker);
 for(const kind of ['wave','dummy-timeout','dummy-manual']){
  const page=await browser.newPage({reducedMotion:'no-preference'}),errors=[];
  try{
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.route('**/native.bundle.js*',route=>route.fulfill({contentType:'application/javascript',body:instrumented}));
   await page.goto(URL);await page.waitForFunction(()=>window.__garrisonReady);
   await page.locator('[data-act=new]').click();await page.locator('[data-act=begin]').click();
   if(kind!=='wave')await page.evaluate(()=>{
    const {state,render,buildPhasePlan,data}=window.__roundEndFlow;
    state.game.s.round=buildPhasePlan(data,state.game.s.modeId).find(t=>t.isBossTurn).round;render();
   });
   await page.locator('[data-act=start]').click();
   if(kind==='dummy-manual')await page.locator('[data-act=stop]').click();
   else await page.evaluate(()=>{
    const b=window.__roundEndFlow.state.game.battle;
    // 保留真实 tick -> finishCurrentBattle -> frame -> render 的结算链路，只快进到时限前。
    b.s.frame=Math.ceil(b.s.limit*30)-1;b.s.time=b.s.frame/30;
   });
   if(kind==='wave'){
    await page.waitForSelector('.native-round-end[data-stage=count]');
    await page.locator('.native-round-end [data-act=next]').click();
    assert.equal(await page.evaluate(()=>window.__roundEndFlow.state.game.s.round),2);
   }else{
    await page.waitForSelector('#native-modal');
    assert.match(await page.locator('#native-modal').innerText(),/木桩测试完成/);
    await page.locator('#native-modal [data-act=close]').click();
    await page.reload();await page.waitForFunction(()=>window.__garrisonReady);
    assert.equal(await page.evaluate(()=>window.__roundEndFlow.state.game.s.phase),'finished');
    await page.locator('[data-act=result]').click();
    assert.match(await page.locator('#native-modal').innerText(),/木桩测试完成/);
    await page.locator('#native-modal [data-act=home]').click();
    assert.equal(await page.locator('.native-lobby').count(),1);
   }
   assert.deepEqual(errors,[],kind);
  }finally{await page.close();}
 }
});

const argv=process.argv.slice(2);
if(argv.includes('--list')){console.log([...suites.keys()].join('\n'));process.exit(0);}
const picked=argv.filter(a=>!a.startsWith('-'));
const names=picked.length?picked:[...suites.keys()];
for(const name of names)if(!suites.has(name)){console.error('未知 suite：'+name+'（可用：'+[...suites.keys()].join(', ')+'）');process.exit(2);}

const browser=await chromium.launch({headless:true,executablePath:EDGE});
const failed=[];
for(const name of names){
 const started=Date.now();
 try{await suites.get(name)(browser);console.log('✔ '+name+' ('+((Date.now()-started)/1000).toFixed(1)+'s)');}
 catch(error){failed.push(name);console.error('✖ '+name+' :: '+(error?.message||error));}
}
await browser.close();
console.log((names.length-failed.length)+'/'+names.length+' suite 通过'+(failed.length?'，失败：'+failed.join(', '):''));
if(failed.length)process.exitCode=1;
