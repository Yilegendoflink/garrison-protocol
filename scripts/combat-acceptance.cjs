const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
let pw;try{pw=require('playwright');}catch{pw=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
(async()=>{
 const browser=await pw.chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
