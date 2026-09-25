// native 客户端的最小 DOM 宿主：真正把 `dist/native.bundle.js` 跑起来（沿用 `tests/startup.test.mjs` 的思路，
// 但走 native 客户端并把定时器做成可派发的虚拟时钟）。给需要「从 UI 层验证」的测试共用：
//   · `tick(n)`   —— 走 rAF（可见状态），虚拟时钟前进 34 毫秒/帧；
//   · `advance(ms)` + `fireTimers()` —— 模拟「页面被切走」：rAF 不再触发，只有被节流的定时器唤醒；
//   · `setHidden(v)` —— 翻转 `document.hidden` 并派发 `visibilitychange`；
//   · `dispatch(act,attrs)` —— 走 #app 上的 click 委托，和真人点击同一条路径；
//   · `virtual(sel)` —— 类选择器（如 `.native-bonds`）返回替身节点：宿主没有真实布局，按选择器复用同一个替身，
//     便于断言「只由 updateHud 更新的块」有没有被写。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {NATIVE_DATA} from '../dist/runtime-data.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(path.join(root,'dist/index.html'),'utf8');
const bundle=await readFile(path.join(root,'dist/native.bundle.js'),'utf8');

export function createHost(){
 const elements=new Map(),documentEvents=new Map(),windowEvents=new Map(),frames=[],timers=[],virtuals=new Map();
 let clock=0,drawCalls=0,timerSeq=0;
 const context2d=new Proxy({}, {get(target,key){
  if(key in target)return target[key];
  if(key==='createLinearGradient'||key==='createRadialGradient'||key==='createConicGradient'||key==='createPattern')return ()=>({addColorStop(){}});
  if(key==='ellipse'||key==='arc')return (...args)=>{assert.ok(args.slice(2,key==='arc'?3:4).every(n=>Number.isFinite(n)&&n>=0));drawCalls++;};
  return ()=>{drawCalls++;};
 },set(target,key,value){target[key]=value;return true;}});
 function registerIds(markup){for(const m of markup.matchAll(/\bid="([\w-]+)"/g))if(!elements.has(m[1]))elements.set(m[1],new Element(m[1]));}
 class Element {
  constructor(id){this.id=id;this.html='';this.textContent='';this.hidden=false;this.open=false;this.isConnected=true;this.listeners=new Map();this.classList={add(){},remove(){},toggle(){},contains:()=>false};this.style={setProperty(k,v){this[k]=v;},removeProperty(){},getPropertyValue(){return '';}};this.attrs={};this.dataset={};this.children=[];}
  set innerHTML(markup){this.html=markup;registerIds(markup);}
  get innerHTML(){return this.html;}
  setAttribute(k,v){this.attrs[k]=v;}
  insertAdjacentHTML(where,markup){if(typeof markup==='string')registerIds(markup);}
  // 同一个元素、同一个事件类型可以注册多个监听（native-play 在 #app 上注册了两次 pointerdown：
  // 主处理器 + 开局的 unlockAudio），宿主必须像真实 DOM 那样全部保留、按注册顺序派发，
  // 否则后注册的那个会把主处理器顶掉，棋盘按压就永远进不去。
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(callback);}
  fire(type,event){for(const callback of this.listeners.get(type)||[])callback(event);}
  getBoundingClientRect(){return {left:0,top:0,right:800,bottom:520,width:800,height:520};}
  getContext(){return context2d;}
  get parentElement(){return this._parent||(this._parent=new Element('parent'));}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
  remove(){this.isConnected=false;}
  append(child){this.children.push(child);}
  // 宿主没有真实节点树与布局：只给「类选择器替身」这一种用途返回节点（当前只有 `.native-bonds`，
  // `updateBondLive` 用它拿侧栏）。其余一律 null——`overBench`/`scrollerAtPoint` 这类命中测试
  // 一旦拿到假节点就会误判「按在整备区上」，把棋盘按压当成拖拽。
  querySelector(selector){return selector==='.native-bonds'?virtual(selector):null;}
  querySelectorAll(){return [];}
  // 宿主里没有真实节点树：事件目标的 `closest` 一律判为「不在任何按钮/档案里」，
  // 这正是棋盘按压需要的结果（native-play 用 e.target===canvas + closest 区分落点）。
  closest(){return null;}
  matches(){return false;}
  setPointerCapture(){}
  hasPointerCapture(){return true;}
  releasePointerCapture(){}
 }
 const virtual=selector=>{if(!virtuals.has(selector))virtuals.set(selector,new Element(selector));return virtuals.get(selector);};
 registerIds(html);
 const data=new Map();
 const storage={getItem(key){return data.get(key)??null;},setItem(key,value){data.set(key,String(value));}};
 // `getElementById` 对未知 id 也返回节点：native 客户端会写一些由它自己生成的角标/计数节点。
 const document={hidden:false,readyState:'complete',activeElement:null,documentElement:{classList:{contains:()=>false,add(){},remove(){},toggle(){}}},body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},elementFromPoint:()=>null,addEventListener:(type,callback)=>documentEvents.set(type,callback),querySelector:selector=>selector==='.native-bonds'?virtual(selector):null,querySelectorAll(){return [];}};
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
 const dispatch=async(act,attrs={})=>{const button={dataset:{act,...attrs},disabled:false};const app=elements.get('app');assert.ok(app.listeners.get('click')?.length,'native 客户端应当把 click 绑在 #app 上');app.fire('click',{target:{closest:()=>button},preventDefault(){},stopPropagation(){}});};
 const save=()=>JSON.parse(storage.getItem('garrison-native-manual-v1')||'null');
 return {host,elements,storage,dispatch,virtual,save,
  get drawCalls(){return drawCalls;},
  tick(count=1){for(let i=0;i<count;i++){clock+=34;const fn=frames.shift();assert.ok(fn,'动画帧应当继续排队');fn(clock);}},
  advance(ms){clock+=ms;},
  fireTimers(){for(let guard=0;guard<200;guard++){const index=timers.findIndex(t=>t.at<=clock);if(index<0)return;const [timer]=timers.splice(index,1);timer.callback();}},
  setHidden(hidden){document.hidden=!!hidden;documentEvents.get('visibilitychange')?.();}};
}

// 大厅 → 战前准备 → 开局（不部署任何干员也能开战，测试只关心模拟是否在推进）。
export async function startBattle(host){
 await host.dispatch('new');
 await host.dispatch('begin');
 await host.dispatch('start');
 host.tick(1);
}

// 买下商店里某张卡（native 的商店卡是「先点开档案、再点一次才买」）并把它落到棋盘上。
export async function deployFirstUnit(host,{buyIndex=0}={}){
 await host.dispatch('buy',{index:String(buyIndex)});          // 第一次点：打开档案
 await host.dispatch('buy',{index:String(buyIndex)});          // 第二次点：购买
 return deployLastUnit(host);
}

// 把整备区最后一张干员卡落到棋盘上：选中它、扫棋盘找第一个能落子的格、选朝向并确认。
// 格子→屏幕坐标的算法与 `native-play.geometry()` 的非横屏分支一致（宿主画布固定 800×520，
// 视口取当前地图的 `viewport`），所以不依赖具体地图的可部署格分布。
export async function deployLastUnit(host){
 const app=host.elements.get('app'),canvas=host.elements.get('native-canvas');
 assert.ok(canvas,'native 客户端应当有 #native-canvas');
 const bought=host.save();
 const unit=bought?.s?.units?.filter(u=>!u.position).at(-1);
 assert.ok(unit,'整备区应当还有未落场的干员');
 await host.dispatch('select',{uid:String(unit.uid)});
 // 选中会同时打开干员档案；档案开着时落在棋盘上的第一下按压只会关掉它（用户口径，见 AGENTS），
 // 所以先显式关掉档案再落子，避免第一下被吞掉。
 await host.dispatch('inspect-close');
 // 关掉详情后的 500 毫秒内，点击会被 `dossierDismissedAt` 的守卫吞掉（防误触）；虚拟时钟走过它再继续。
 host.tick(20);
 const saved=host.save();
 const map=NATIVE_DATA.maps.find(m=>m.stageId===saved?.s?.mapId);
 assert.ok(map,`存档里应当有本局地图（${saved?.s?.mapId}）`);
 const v=map.viewport,cols=v.right-v.left+1,rows=v.bottom-v.top+1,rect=canvas.getBoundingClientRect();
 const left=16,top=22,width=rect.width-32,height=rect.height-44;
 const tw=Math.min(width/cols,height/rows/.82),th=tw*.82;
 const ox=left+(width-tw*cols)/2-v.left*tw,oy=top+(height-th*rows)/2-v.top*th;
 const target=canvas;   // 棋盘的指针事件要求 e.target === canvas（native-play 的 pointerdown 里就这么判的）
 const fire=(type,x,y)=>app.fire(type,{clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0,pointerType:'mouse',target,preventDefault(){},stopPropagation(){}});
 let spot=null;
 for(let y=v.top;y<=v.bottom&&!spot;y++)for(let x=v.left;x<=v.right&&!spot;x++){
  const cx=rect.left+ox+x*tw+tw/2,cy=rect.top+oy+y*th+th/2;
  fire('pointerdown',cx,cy);fire('pointerup',cx,cy);
  if(/class="native-facing"\s*>/.test(app.innerHTML))spot={x,y};
 }
 assert.ok(spot,'棋盘上应当至少有一个可部署格');
 host.tick(20);                                       // 同样让开守卫，保证下面的「选朝向／确认」点击不被吞
 await host.dispatch('aim',{dir:'0'});
 await host.dispatch('place-confirm');
 assert.ok(host.save().s.units.some(u=>u.position),'落子后场上应当有干员');
 return spot;
}

// 干员开局：买第一张卡 → 落子 → 开战（与真人点击同一条路径）。
export async function startBattleWithUnit(host,{buyIndex=0}={}){
 await host.dispatch('new');
 await host.dispatch('begin');
 await deployFirstUnit(host,{buyIndex});
 await host.dispatch('start');
 host.tick(1);
}
