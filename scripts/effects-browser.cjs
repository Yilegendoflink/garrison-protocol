const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
let pw;try{pw=require('playwright');}catch{pw=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
(async()=>{
 const {openBattle,deployNow,reps}=await import('../tests/effects-harness.mjs');
 const {g,b}=openBattle([reps.operators.silent,reps.operators.yak]);deployNow(b);b.s.limit=300;
 const snapshot=JSON.parse(JSON.stringify(g.snapshot())),token=snapshot.battle.summons[0];assert.ok(token);
 const browser=await pw.chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
