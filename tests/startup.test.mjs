import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(path.join(root,'dist/index.html'),'utf8');
const bundle=await readFile(path.join(root,'dist/game.bundle.js'),'utf8');

// A small host-API fixture executes the real delivered JavaScript. It does not
// emulate browser layout, painting or rendering; these are startup regressions.
function createHost({restrictedStorage=false,resizeObserver=true}={}){
 const elements=new Map(),documentEvents=new Map(),windowEvents=new Map(),frames=[],images=[];
 let clock=0,drawCalls=0;
 const context2d=new Proxy({}, {get(target,key){
   if(key in target)return target[key];
   if(key==='createLinearGradient')return ()=>({addColorStop(){}});
   if(key==='ellipse'||key==='arc')return (...args)=>{assert.ok(args.slice(2,key==='arc'?3:4).every(n=>Number.isFinite(n)&&n>=0));drawCalls++;};
   return ()=>{drawCalls++;};
 },set(target,key,value){target[key]=value;return true;}});
 function registerIds(markup){for(const m of markup.matchAll(/\bid="([\w-]+)"/g))if(!elements.has(m[1]))elements.set(m[1],new Element(m[1]));}
 class Element {
  constructor(id){this.id=id;this.html='';this.textContent='';this.hidden=false;this.open=false;this.isConnected=true;this.listeners=new Map();this.classList={add(){},remove(){}};this.style={setProperty(k,v){this[k]=v;}};this.attrs={};}
  set innerHTML(markup){this.html=markup;registerIds(markup);}
  get innerHTML(){return this.html;}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  getBoundingClientRect(){return {left:0,top:0,right:800,bottom:520,width:800,height:520};}
  getContext(){return context2d;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
  remove(){this.isConnected=false;}
  setPointerCapture(){}
  hasPointerCapture(){return true;}
  releasePointerCapture(){}
 }
 registerIds(html);
 const data=new Map();
 const storage={getItem(key){if(restrictedStorage)throw new Error('Storage blocked');return data.get(key)??null;},setItem(key,value){if(restrictedStorage)throw new Error('Storage blocked');data.set(key,String(value));}};
 const document={hidden:false,readyState:'complete',activeElement:null,documentElement:{},getElementById:id=>elements.get(id)||null,addEventListener:(type,callback)=>documentEvents.set(type,callback)};
 const window={devicePixelRatio:1,addEventListener:(type,callback)=>windowEvents.set(type,callback)};
 const host={window,document,localStorage:storage,Image:class{constructor(){this.complete=true;this.naturalWidth=180;}set src(value){this.url=value;images.push(value);}get src(){return this.url;}},performance:{now:()=>clock},requestAnimationFrame:callback=>frames.push(callback),setTimeout:()=>1,clearTimeout(){},console};
 if(resizeObserver)host.ResizeObserver=class {observe(){}};
 const context=vm.createContext(host);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(match[1].trim())vm.runInContext(match[1],context);}
 vm.runInContext(bundle,context,{filename:'game.bundle.js',timeout:2000});
 const dispatch=async(act,attrs={})=>{const button={dataset:{act,...attrs},disabled:false};await documentEvents.get('click')({target:{closest:()=>button}});};
 return {host,elements,images,dispatch,get drawCalls(){return drawCalls;},pointer(type,event){elements.get('battlefield').listeners.get(type)(event);},tick(count=1){for(let i=0;i<count;i++){clock+=34;const fn=frames.shift();assert.ok(fn,'animation frame continues');fn(clock);}}};
}

test('downloaded classic-script entry compiles and initializes the real interface',async()=>{
 assert.doesNotThrow(()=>new vm.Script(bundle));
 const host=createHost();
 assert.equal(host.host.window.__garrisonReady,true);
 assert.equal(host.elements.get('boot-screen').isConnected,false);
 assert.match(host.elements.get('board-overlay').innerHTML,/开始独立模拟/);
 assert.ok(host.drawCalls>100,'the battlefield issues drawing operations');
 assert.match(host.elements.get('screen-root').innerHTML,/开始模拟/);
 await host.dispatch('setup');assert.match(host.elements.get('screen-root').innerHTML,/选择模拟协议/);
 await host.dispatch('briefing');assert.match(host.elements.get('screen-root').innerHTML,/模拟简报/);
 await host.dispatch('begin');assert.match(host.elements.get('shop').innerHTML,/芬/);
 await host.dispatch('buy',{index:'0'});assert.match(host.elements.get('bench').innerHTML,/芬/);
 await host.dispatch('select',{uid:'1'});
 const event={button:0,clientX:280,clientY:166,pointerId:1};
 host.pointer('pointerdown',event);host.pointer('pointerup',event);assert.equal(host.elements.get('deployment-layer').hidden,false);await host.dispatch('deploy-direction',{value:'0'});await host.dispatch('deploy-confirm');
 assert.match(host.elements.get('deployment-count').textContent,/1 \/ 8/);
 await host.dispatch('start');
 assert.match(host.elements.get('phase').textContent,/作战中/);
 host.tick(90);
 assert.ok(host.host.window.__garrisonReady);
});

test('startup works with unavailable storage and a ResizeObserver fallback',()=>{
 const host=createHost({restrictedStorage:true,resizeObserver:false});
 assert.equal(host.host.window.__garrisonReady,true);
 assert.match(host.elements.get('board-overlay').innerHTML,/开始独立模拟/);
 host.tick(3);
});

test('all startup and image paths resolve under a nested folder and file URL',async()=>{
 assert.doesNotMatch(html,/type="module"/);
 const css=await readFile(path.join(root,'dist/style.css'),'utf8');
 assert.doesNotMatch(css,/@import\s+url\(['"]?https?:/);
 const refs=[...html.matchAll(/(?:src|href)="(\.[^"]+)"/g)].map(m=>m[1]);
 refs.push(...createHost().images);
 for(const ref of refs){
  assert.ok(ref.startsWith('./'),`relative resource: ${ref}`);
  await access(path.join(root,'dist',ref.split(/[?#]/)[0]));
  for(const base of ['http://127.0.0.1:5500/unpacked/garrison-protocol/dist/index.html','file:///C:/Games/garrison-protocol/dist/index.html']){
   const resolved=new URL(ref,base);
   assert.ok(resolved.pathname.includes('/garrison-protocol/dist/'),resolved.href);
  }
 }
 const launcher=await readFile(path.join(root,'index.html'),'utf8');
 assert.match(launcher,/url=\.\/dist\/index\.html/);
});
