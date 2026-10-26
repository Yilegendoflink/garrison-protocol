import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {weeklyChallengeSnapshot} from '../dist/native-challenges.js';
import {HAND_LIMIT} from '../dist/protocol.js';

const root=fileURLToPath(new URL('../dist/',import.meta.url)),output=path.resolve('artifacts/weekly-merge');
const server=http.createServer(async(req,res)=>{
 try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root)){res.writeHead(403).end();return;}const body=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js')).href);}
 const {chromium}=pw.default||pw;browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 await fs.mkdir(output,{recursive:true});const reports=[];
 for(const entry of data.weeklyChallenges.entries.filter(e=>e.challengeId==='tier-one-pair')){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/*__weekly_challenge_clock*',r=>r.fulfill({status:200,headers:{date:new Date(Date.parse(entry.startsAt)+3600000).toUTCString()}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__garrisonReady);
  await page.locator('[data-act=weekly-challenge]').click();await page.locator('.briefing-weekly-card').waitFor();
  assert.match(await page.locator('.briefing-weekly-card').innerText(),/成双成才/);assert.match(await page.locator('.briefing-weekly-card').innerText(),/两名相同初始干员/);
  await page.screenshot({path:path.join(output,`${entry.id}-briefing.png`),fullPage:true});
  await page.locator('[data-act=begin]').click();await page.locator('.native-game').waitFor();
  const base='chess_char_1_02_a',elite=data.season.charChessDataDict[base].upgradeChessId,weeklyChallenge=weeklyChallengeSnapshot({...entry,timeZone:data.weeklyChallenges.timeZone},Date.parse(entry.startsAt));
  const g=new NativeSession(data,{seed:42,bandId:'band_amiya',bondBan:{bonds:[]},weeklyChallenge});g.setFunds(20);g.s.offers=[base];assert.equal(g.perform('buy',0),true);g.s.offers=[base];
  g.s.items=Array.from({length:HAND_LIMIT-1},()=>({uid:++g.s.seq,chessId:'chess_item_3_04_e_a'}));assert.equal(g.handFull(),true);const expected=g.s.funds-g.price(base)+1;
  await page.locator('[data-act=home]').click();await page.evaluate(r=>{for(const key of ['garrison-native-manual-v1','garrison-native-safe-v1'])localStorage.setItem(key,JSON.stringify(r));},g.snapshot());
  await page.reload();await page.waitForFunction(()=>window.__garrisonReady);if(await page.locator('[data-act=resume]').count())await page.locator('[data-act=resume]').click();
  const offer=page.locator('[data-act=buy][data-index="0"]');assert.match(await offer.getAttribute('class'),/native-shop-merge-ready/);assert.equal(await offer.getAttribute('title'),'购买后触发干员合成');
  await offer.click();await offer.click();await page.waitForFunction(id=>JSON.parse(localStorage.getItem('garrison-native-manual-v1'))?.s.units.some(u=>u.chessId===id),elite);
  const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('garrison-native-manual-v1')).s);assert.equal(result.funds,expected);assert.equal(result.units.length,1);assert.deepEqual(result.units[0].purchases,{[base]:2});assert.ok(result.rewardPending?.tier);
  await page.screenshot({path:path.join(output,`${entry.id}-merged.png`),fullPage:true});assert.deepEqual(errors,[]);reports.push({id:entry.id,passed:true,funds:result.funds});await page.close();
 }
 await fs.writeFile(path.join(output,'browser.json'),JSON.stringify({passed:true,reports,checks:['两期服务器校时入口与简报','第二张同名卡合成高亮','满手买入并两名合成','额外1资金与晋升奖励','两份库存记录']},null,2)+'\n');console.log('✔ weekly-merge browser (both weeks)');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
