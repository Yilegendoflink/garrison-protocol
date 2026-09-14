const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
(async()=>{
 const browser=await pw.chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
