// 用户 2026-09-23 口径：「网页切走时后台继续运行而不是暂停」。
// 这条只能在**真正启动 native 客户端**的前提下验证，所以本文件带一个最小 DOM 宿主（沿用
// `tests/startup.test.mjs` 的思路，但跑的是 `dist/native.bundle.js`，并把定时器做成可派发的虚拟时钟）：
//   · `tick(n)`   —— 走 rAF（可见状态），虚拟时钟前进 34 毫秒/帧；
//   · `advance(ms)` + `fireTimers()` —— 模拟「页面被切走」：rAF 不再触发，只有定时器被节流唤醒；
//   · `setHidden(v)` —— 翻转 `document.hidden` 并派发 `visibilitychange`。
// 战斗时钟的读数取自自动存档（`snapshot().battle.time`），因为 `battle` 只在存档里可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(path.join(root,'dist/index.html'),'utf8');
const bundle=await readFile(path.join(root,'dist/native.bundle.js'),'utf8');

function createHost(){
 const elements=new Map(),documentEvents=new Map(),windowEvents=new Map(),frames=[],timers=[];
 let clock=0,drawCalls=0,timerSeq=0;
 const context2d=new Proxy({}, {get(target,key){
  if(key in target)return target[key];
  if(key==='createLinearGradient'||key==='createRadialGradient'||key==='createConicGradient'||key==='createPattern')return ()=>({addColorStop(){}});
  if(key==='ellipse'||key==='arc')return (...args)=>{assert.ok(args.slice(2,key==='arc'?3:4).every(n=>Number.isFinite(n)&&n>=0));drawCalls++;};
  return ()=>{drawCalls++;};
 },set(target,key,value){target[key]=value;return true;}});
 function registerIds(markup){for(const m of markup.matchAll(/\bid="([\w-]+)"/g))if(!elements.has(m[1]))elements.set(m[1],new Element(m[1]));}
 class Element {
  constructor(id){this.id=id;this.html='';this.textContent='';this.hidden=false;this.open=false;this.isConnected=true;this.listeners=new Map();this.classList={add(){},remove(){},toggle(){},contains:()=>false};this.style={setProperty(k,v){this[k]=v;},removeProperty(){},getPropertyValue(){return '';}};this.attrs={};this.children=[];}
  set innerHTML(markup){this.html=markup;registerIds(markup);}
  get innerHTML(){return this.html;}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  getBoundingClientRect(){return {left:0,top:0,right:800,bottom:520,width:800,height:520};}
  getContext(){return context2d;}
  get parentElement(){return this._parent||(this._parent=new Element('parent'));}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
  remove(){this.isConnected=false;}
  append(child){this.children.push(child);}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  setPointerCapture(){}
  hasPointerCapture(){return true;}
  releasePointerCapture(){}
 }
 registerIds(html);
 const data=new Map();
 const storage={getItem(key){return data.get(key)??null;},setItem(key,value){data.set(key,String(value));}};
 // `getElementById` 对未知 id 也返回节点：native 客户端会写一些由它自己生成的角标/计数节点。
 const document={hidden:false,readyState:'complete',activeElement:null,documentElement:{classList:{contains:()=>false,add(){},remove(){},toggle(){}}},body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},addEventListener:(type,callback)=>documentEvents.set(type,callback),querySelector(){return null;},querySelectorAll(){return [];}};
 const window={devicePixelRatio:1,innerWidth:1024,innerHeight:768,addEventListener:(type,callback)=>windowEvents.set(type,callback),matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})};
 const host={window,document,localStorage:storage,innerWidth:1024,innerHeight:768,
  Image:class{constructor(){this.complete=true;this.naturalWidth=180;}set src(value){this.url=value;}get src(){return this.url;}},
  performance:{now:()=>clock},requestAnimationFrame:callback=>frames.push(callback),
  // 定时器按虚拟时钟排队：`fireTimers()` 只跑「到期」的回调，够测后台补帧（`scheduleBackground`）。
  setTimeout:(callback,ms=0)=>{const id=++timerSeq;timers.push({id,at:clock+(Number(ms)||0),callback});return id;},
  clearTimeout:id=>{const index=timers.findIndex(t=>t.id===id);if(index>=0)timers.splice(index,1);},
  console};
 host.ResizeObserver=class{observe(){}};host.matchMedia=window.matchMedia;host.structuredClone=structuredClone;
 // 固定时钟：开局种子取自 `Date.now()`，不固定的话每次跑到的地图都不一样（绘制路径与断言都会飘）。
 host.Date=class extends Date{static now(){return 1727000000000;}};
 const context=vm.createContext(host);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(match[1].trim())vm.runInContext(match[1],context);}
 vm.runInContext(bundle,context,{filename:'native.bundle.js',timeout:3000});
 const dispatch=async(act,attrs={})=>{const button={dataset:{act,...attrs},disabled:false};const handler=elements.get('app').listeners.get('click');assert.ok(handler,'native 客户端应当把 click 绑在 #app 上');await handler({target:{closest:()=>handler&&button},preventDefault(){},stopPropagation(){}});};
 return {host,elements,storage,dispatch,
  get drawCalls(){return drawCalls;},
  tick(count=1){for(let i=0;i<count;i++){clock+=34;const fn=frames.shift();assert.ok(fn,'动画帧应当继续排队');fn(clock);}},
  advance(ms){clock+=ms;},
  fireTimers(){for(let guard=0;guard<200;guard++){const index=timers.findIndex(t=>t.at<=clock);if(index<0)return;const [timer]=timers.splice(index,1);timer.callback();}},
  setHidden(hidden){document.hidden=!!hidden;documentEvents.get('visibilitychange')?.();}};
}
// 大厅 → 战前准备 → 开局（不部署任何干员也能开战，测试只关心模拟是否在推进）
async function startBattle(host){
 await host.dispatch('new');
 await host.dispatch('begin');
 await host.dispatch('start');
 host.tick(1);
}
// 战斗时钟的读数取自己方状态条里的「剩余时间」（`updateHud` 每 0.2 秒模拟时间刷新一次，
// 可见与后台都会刷新）。不用自动存档读：存档只在 `saveTime>2` 时写，读数天然滞后。
const remaining=host=>{const m=/剩余时间<\/small><b>(\d+)/.exec(host.elements.get('native-status').innerHTML);return m?Number(m[1]):null;};

test('切走页面不再暂停：隐藏时后台按真实时间补帧，回到前台恢复绘制',async()=>{
 const host=createHost();
 await startBattle(host);
 host.tick(70);
 const before=remaining(host),draws=host.drawCalls;
 assert.ok(before>0,'状态条应当显示本波剩余时间');
 // 切走：rAF 停摆，只剩被节流的定时器
 host.setHidden(true);
 host.advance(5000);                               // 真实时间过了 5 秒
 host.fireTimers();                                // 后台驱动唤醒
 const spent=before-remaining(host);
 assert.ok(spent>=4&&spent<=6,`后台应当按真实时间推进约 5 秒（推进了 ${spent} 秒）`);
 assert.equal(host.drawCalls,draws,'后台不重绘画布（省电，也不做没人看的绘制）');
 // 回到前台：rAF 恢复，立刻补绘制并继续推进
 host.setHidden(false);
 host.tick(1);
 assert.ok(host.drawCalls>draws,'回到前台恢复绘制');
 const resumed=remaining(host);
 host.tick(30);
 assert.ok(remaining(host)<resumed,'回到前台后战斗继续推进');
});

test('手动暂停仍然有效：暂停状态下切走页面，后台也不推进模拟',async()=>{
 const host=createHost();
 await startBattle(host);
 host.tick(70);
 assert.match(host.elements.get('app').html,/data-act="pause"[^>]*>暂停</,'未暂停时按钮是「暂停」');
 await host.dispatch('pause');                     // 玩家自己按的暂停
 assert.match(host.elements.get('app').html,/data-act="pause"[^>]*>继续</,'暂停后按钮变成「继续」');
 const pausedAt=remaining(host);
 host.setHidden(true);
 host.advance(5000);host.fireTimers();
 assert.equal(remaining(host),pausedAt,'暂停时后台不补帧');
 host.setHidden(false);
 host.tick(30);
 assert.equal(remaining(host),pausedAt,'回到前台仍然暂停（等玩家继续）');
});
