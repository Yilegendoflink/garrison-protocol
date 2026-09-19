// 手机端盟约面板布局检查（需要先起本地服务：`npm run dev` 会在 5502 提供 dist/）。
// 背景：横屏手机 UI 的左侧盟约竖列是 flex column，卡片默认 flex-shrink:1，盟约一多就被压扁、
// 名字和层数挤在一格里。修法是卡片 flex:0 0 auto + 面板 overflow-y:auto（见 dist/native.css 的
// html.native-landscape-ui 段）。本脚本用真浏览器量：卡片是否保持自然高度、面板是否上下滚动，
// 并故意注入旧规则（允许压扁）做对照，确保测的正是这个变量。
// 运行：node scripts/mobile-bonds-browser.mjs   （截图与报告落在 artifacts/mobile-bonds/）
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js')).href);}
const {chromium}=pw.default||pw;

const EDGE=process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL=process.env.MOBILE_BONDS_URL||'http://127.0.0.1:5502/';
const OUT='artifacts/mobile-bonds';
const ANDROID='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const results=[];
await fs.mkdir(OUT,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:EDGE});

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
await browser.close();
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
process.exitCode=fail.length?1:0;
