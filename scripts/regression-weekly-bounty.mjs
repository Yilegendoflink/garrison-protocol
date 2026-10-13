import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {weeklyChallengeSnapshot} from '../dist/native-challenges.js';

let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js')).href);}
const {chromium}=pw.default||pw;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
const entry=data.weeklyChallenges.entries.find(e=>e.challengeId==='bounty-takeover'),weeklyChallenge=weeklyChallengeSnapshot(entry,Date.parse(entry.startsAt));
const record=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('garrison-native-manual-v1')));
page.on('pageerror',error=>errors.push(error.message));
await fs.mkdir('artifacts/weekly-bounty',{recursive:true});
try{
 await page.emulateMedia({reducedMotion:'reduce'});
 // 用服务器校时响应进入下一期，验证真实入口与简报。
 await page.route('**/*__weekly_challenge_clock*',route=>route.fulfill({status:200,headers:{date:new Date(Date.parse(entry.startsAt)+3600000).toUTCString()}}));
 await page.goto(process.env.REGRESSION_URL||'http://127.0.0.1:5502/');await page.waitForFunction(()=>window.__garrisonReady);
 await page.locator('[data-act=weekly-challenge]').click();await page.locator('.briefing-weekly-card').waitFor();
 assert.match(await page.locator('.briefing-weekly-card').innerText(),/全域悬赏/);
 await page.locator('[data-act=begin]').click();const cards=page.locator('[data-choice-kind=decision] [data-act=decision]');
 await cards.first().waitFor();assert.equal(await cards.count(),3);
 assert.match(await page.locator('[data-choice-kind=decision]').innerText(),/非完美无赏金/);
 await page.screenshot({path:'artifacts/weekly-bounty/decision-desktop.png',fullPage:true});
 for(const viewport of [{width:375,height:812},{width:768,height:420}]){
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const box=await page.locator('.native-choice-overlay>section').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);
  await page.screenshot({path:`artifacts/weekly-bounty/decision-${viewport.width}.png`,fullPage:true});
 }
 const selected=(await record()).s.roundDecisions[1];await cards.nth(1).click();
 const prep=await record();assert.equal(prep.s.phase,'prep');assert.equal(prep.s.weeklyBounty.enemyId,selected.enemyId);
 assert.ok(prep.s.preparedDoorWave.queue.every(q=>q.id===selected.enemyId));
 await page.reload();await page.waitForFunction(()=>window.__garrisonReady);if(await page.locator('[data-act=resume]').count())await page.locator('[data-act=resume]').click();
 assert.equal(await cards.count(),0);assert.equal((await record()).s.weeklyBounty.enemyId,selected.enemyId);
 await page.locator('[data-act=start]').click();await page.waitForFunction(()=>document.querySelector('.native-game')?.classList.contains('is-battle'));
 assert.ok((await record()).battle.queue.every(q=>q.id===selected.enemyId));
 // 结算记录恢复后，下一轮仍固定弹一次选择，奖金在选完后入账。
 const g=new NativeSession(data,{seed:42,bondBan:{bonds:[]},weeklyChallenge});g.perform('decision',g.s.roundDecisions[1].id);g.perform('start');
 g.battle.s.bountyPending=2;g.battle.finish('complete');g.finishCurrentBattle();
 await page.locator('[data-act=home]').click();
 await page.evaluate(r=>{for(const key of ['garrison-native-manual-v1','garrison-native-safe-v1'])localStorage.setItem(key,JSON.stringify(r));},g.snapshot());
 await page.reload();await page.waitForFunction(()=>window.__garrisonReady);if(await page.locator('[data-act=resume]').count())await page.locator('[data-act=resume]').click();
 await page.locator('[data-act=next]').first().click();await cards.first().waitFor();assert.equal((await record()).s.round,2);
 await cards.first().click();assert.equal((await record()).s.nextRoundBonus,0);assert.equal((await record()).s.funds,11);
 assert.deepEqual(errors,[]);
 await fs.writeFile('artifacts/weekly-bounty/browser.json',JSON.stringify({passed:true,checks:['服务器校时入口','首轮悬赏与三倍文案','窄屏和横屏无溢出','整轮替换','读档不重选','下一轮固定选择与奖金到账'],errors},null,2)+'\n');
 console.log('✔ weekly-bounty browser');
}finally{await browser.close();}
