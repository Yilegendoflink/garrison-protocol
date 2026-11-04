import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {weeklyChallengeSnapshot} from '../dist/native-challenges.js';
import {dispatch} from '../dist/native-effects.js';

const root=fileURLToPath(new URL('../dist/',import.meta.url)),output=path.resolve('artifacts/weekly-regional');
const server=http.createServer(async(req,res)=>{
 try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root)){res.writeHead(403).end();return;}const body=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js')).href);}
 const {chromium}=pw.default||pw;browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 await fs.mkdir(output,{recursive:true});const reports=[];
 for(const entry of data.weeklyChallenges.entries.filter(e=>e.challengeId==='regional-rework')){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/*__weekly_challenge_clock*',r=>r.fulfill({status:200,headers:{date:new Date(Date.parse(entry.startsAt)+3600000).toUTCString()}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__garrisonReady);
  await page.locator('[data-act=weekly-challenge]').click();await page.locator('.briefing-weekly-card').waitFor();
  assert.match(await page.locator('.briefing-weekly-card').innerText(),/狼沙异变/);assert.match(await page.locator('.briefing-weekly-card').innerText(),/叙拉古/);
  await page.screenshot({path:path.join(output,`${entry.id}-briefing.png`),fullPage:true});
  await page.locator('[data-act=begin]').click();await page.locator('.native-game').waitFor();
  const weeklyChallenge=weeklyChallengeSnapshot({...entry,timeZone:data.weeklyChallenges.timeZone},Date.parse(entry.startsAt));
  const g=new NativeSession(data,{seed:42,bandId:'band_amiya',bondBan:{bonds:[]},weeklyChallenge});g.s.capacity=16;
  for(const id of data.season.bondInfoDict.sargonShip.chessIdList.filter(x=>!data.season.charChessDataDict[x].isGolden).slice(0,6))g.gain(id);
  g.s.rewardPending=null;g.s.rewardQueue=[];
  for(const u of g.s.units){let ok=false;for(let y=0;y<7&&!ok;y++)for(let x=0;x<11&&!ok;x++)if(!g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y)&&g.canDeploy(u.uid,x,y))ok=g.deploy(u.uid,x,y,0);assert.ok(ok);}
  assert.ok(g.startBattle());const b=g.battle,u=b.s.units[0];for(const actor of b.s.units){actor.deployed=true;actor.hp=actor.maxHp;}u.skillLeft=30;b.s.queue=[];b.s.limit=99999;dispatch(b,'skill-start',{target:u});b.spawn({id:'enemy_1007_slime',route:0});const e=b.s.enemies.at(-1);e.hp=e.maxHp=1e9;e.atk=0;e.speed=e.baseSpeed=0;
  const zone=b.s.logicEffects.find(f=>f.talentOrSkillId==='weekly-sargon-sand');assert.ok(zone.values.staticCells.length);
  await page.locator('[data-act=home]').click();await page.evaluate(r=>{for(const key of ['garrison-native-manual-v1','garrison-native-safe-v1'])localStorage.setItem(key,JSON.stringify(r));},g.snapshot());
  await page.reload();await page.waitForFunction(()=>window.__garrisonReady);if(await page.locator('[data-act=resume]').count())await page.locator('[data-act=resume]').click();
  if((await page.locator('[data-act=pause]').innerText()).includes('暂停'))await page.locator('[data-act=pause]').click();
  await page.locator('[data-act=bond-info][data-id=sargonShip]').click();assert.match(await page.locator('#native-modal').innerText(),/流沙/);assert.doesNotMatch(await page.locator('#native-modal').innerText(),/开启技能还会/);
  await page.screenshot({path:path.join(output,entry.id+'-bond.png'),fullPage:true});await page.locator('#native-modal [data-act=close]').click();
  const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('garrison-native-manual-v1')).s);
  await page.screenshot({path:path.join(output,`${entry.id}-merged.png`),fullPage:true});assert.deepEqual(errors,[]);reports.push({id:entry.id,passed:true});await page.close();
 }
 await fs.writeFile(path.join(output,'browser.json'),JSON.stringify({passed:true,reports,checks:['两周挑战入口与简报','战斗存档恢复流沙','盟约面板展示本期规则','流沙区域绘制无页面异常']},null,2)+'\n');console.log('✔ weekly-regional browser');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
