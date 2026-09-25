// 凯瑟琳「定向支援信号」的支援装置（爬行号·防护单元 `token_10041_cathy_catsld`）。
// 依据 PRTS：干员页（旧 id 394093）特性「能够阻挡两个敌人，使用<支援装置>协助作战」＋分支信息
// 「干员部署后，按天赋描述数量补充支援装置持有数／干员离场后，附属的支援装置随之消失」；
// 召唤物页（oldid 386131）「部署位置：全部位／部署占用数 0／不会受到攻击」＋召唤物天赋
// 「使**攻击范围内**一名友方干员获得相当于凯瑟琳生命上限 X% 的屏障（若目标最近 5 秒内未受攻击，
// 则每秒补充 6% 的屏障，不超过初始上限），装置效果不叠加」。
// 用户 2026-09-22 报「凯瑟琳的召唤物依然不能正确放置在场上」——根因是落点统一套用了战术家
// 「只能在攻击范围内选点」的口径，装置只能放在她自己脚下或身前那一格。
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {cathyDeviceValues,teleportActor} from '../dist/native-effects.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

const CHESS={cathy:'chess_char_4_11_a',cathyElite:'chess_char_4_11_b',yak:null};
const chessOf=charId=>Object.values(data.season.charShopChessDatas).find(s=>s.charId===charId&&!s.isHidden).chessId;
const FRONT=[[1,0],[0,1],[-1,0],[0,-1]];

function session(units=['char_4162_cathy','char_199_yak']){
 const g=new NativeSession(data,{seed:1,bondBan:NO_BOND_BAN});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 const free=[];for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++){const cell=g.map.grid[y][x];if(cell.buildableType!=='NONE'&&!cell.obstacle)free.push({x,y,high:cell.heightType==='HIGHLAND'});}
 const gained=units.map(id=>g.gain(chessOf(id)));
 const first=gained[0],spot=free[0];
 assert.equal(g.deploy(first.uid,spot.x,spot.y,0),true,'凯瑟琳需要落场');
 const near=free.find(f=>Math.abs(f.x-spot.x)+Math.abs(f.y-spot.y)===1);
 if(gained[1]&&near)assert.equal(g.deploy(gained[1].uid,near.x,near.y,0),true,'同伴需要落场');
 g.s.rewardPending=null;g.s.rewardQueue=[];g.syncSummonCards();
 return {g,free,spot,near,cathy:first,ally:gained[1]||null,cards:()=>g.s.summonCards.filter(c=>c.type==='cathy-device')};
}
const dirTo=(from,to)=>to.x>from.x?0:to.x<from.x?2:to.y>from.y?1:3;

test('支援装置的落点不再受凯瑟琳攻击范围限制：任意可部署格（含高台）都能放',()=>{
 const {g,free,cards,cathy}=session();
 // 旧口径只允许「自身格＋身前格」两格；现在应当等于全图可部署格。
 const placeable=free.filter(f=>g.canDeploySummonCard(cards()[0].uid,f.x,f.y));
 assert.equal(placeable.length,free.length,'全部可部署格都能放装置');
 assert.ok(free.length>3,'地图上不止两三格可部署');
 const far=free.filter(f=>Math.abs(f.x-cathy.position.x)+Math.abs(f.y-cathy.position.y)>1);
 assert.ok(far.length>0&&far.every(f=>g.canDeploySummonCard(cards()[0].uid,f.x,f.y)),'远处格子也能放（旧口径只能放在自己脚下/身前）');
 if(free.some(f=>f.high))assert.ok(g.canDeploySummonCard(cards()[0].uid,free.find(f=>f.high).x,free.find(f=>f.high).y),'全部位：高台也能放');
 // 战术家（伺夜）仍然是「攻击范围内选点」，没有跟着放开
 const tact=new NativeSession(data,{seed:1,bondBan:NO_BOND_BAN});tact.s.funds=9999;tact.s.rewardPending=null;tact.s.rewardQueue=[];
 const vigil=tact.gain(chessOf('char_427_vigil'));
 const tfree=[];for(let y=0;y<tact.map.rows;y++)for(let x=0;x<tact.map.cols;x++){const cell=tact.map.grid[y][x];if(cell.buildableType!=='NONE'&&!cell.obstacle)tfree.push({x,y});}
 tact.deploy(vigil.uid,tfree[0].x,tfree[0].y,0);tact.syncSummonCards();
 const wolf=tact.s.summonCards.find(c=>c.type==='vigil-wolf');
 const wolfOk=tfree.filter(f=>tact.canDeploySummonCard(wolf.uid,f.x,f.y));
 assert.ok(wolfOk.length<tfree.length,'战术家的召唤卡仍然只能在攻击范围内');
 assert.ok(wolfOk.length>0,'战术家仍然有可放置格');
 // 远离伺夜的格子一律不可放（口径没跟着装置一起放开）
 const farCell=tfree.find(f=>Math.abs(f.x-vigil.position.x)+Math.abs(f.y-vigil.position.y)>4);
 if(farCell)assert.equal(tact.canDeploySummonCard(wolf.uid,farCell.x,farCell.y),false,'战术家的卡不能在远处落点');
});

test('装置按自己的攻击范围（自身格＋身前格）选屏障目标，凯瑟琳本人也算范围内友方',()=>{
 const {g,spot,near,cards,cathy,ally}=session();
 assert.ok(ally&&near,'需要一个同伴');
 // 装置放在同伴格上、朝向凯瑟琳：同伴在自身格（距离 0）拿到屏障
 assert.equal(g.deploySummonCard(cards()[0].uid,near.x,near.y,dirTo(near,spot)),true);
 assert.equal(g.perform('start'),true,g.lastError||'');
 const b=g.battle,U=id=>b.s.units.find(u=>u.id===id);
 const device=b.s.summons.find(s=>s.type==='cathy-device');
 assert.ok(device,'开战要生成装置');
 assert.equal(device.x,near.x);assert.equal(device.y,near.y);
 assert.equal(device.anchorUid,U('char_199_yak').uid,'目标是装置范围内的同伴');
 assert.ok(Math.abs(U('char_199_yak').shield-U('char_4162_cathy').maxHp*0.2)<1e-6,'屏障 = 凯瑟琳生命上限 ×20%');
 // 朝向反过来（背对凯瑟琳）时，范围内没有别人 → 谁都不发
 const {g:g2,cards:cards2,cathy:cathy2}=session(['char_4162_cathy']);
 assert.equal(g2.deploySummonCard(cards2()[0].uid,3,0,0),true);
 assert.equal(g2.perform('start'),true,g2.lastError||'');
 assert.equal(g2.battle.s.summons.find(s=>s.type==='cathy-device').anchorUid,cathy2.uid,'对准自己＝自辅自护');
});

test('部署占用数 0：装置先摆好、干员后压在同一格上也能吃到屏障',()=>{
 const {g,free,cards}=session(['char_4162_cathy','char_199_yak']);
 const yakPrep=g.s.units.find(u=>u.charId==='char_199_yak');
 const empty=free.find(f=>!g.s.units.some(u=>u.position?.x===f.x&&u.position?.y===f.y)&&(f.x!==yakPrep.position.x||f.y!==yakPrep.position.y));
 assert.ok(empty,'需要一块空地');
 assert.equal(g.deploySummonCard(cards()[0].uid,empty.x,empty.y,0),true);
 assert.equal(g.canDeploy(yakPrep.uid,empty.x,empty.y),true,'部署占用数 0 的装置不挡干员落位');
 assert.equal(g.deploy(yakPrep.uid,empty.x,empty.y,0),true);
 assert.equal(g.perform('start'),true,g.lastError||'');
 const b=g.battle,device=b.s.summons.find(s=>s.type==='cathy-device');
 assert.equal(device.anchorUid,b.s.units.find(u=>u.id==='char_199_yak').uid,'后上场的干员同样在装置范围内');
 assert.ok(b.s.units.find(u=>u.id==='char_199_yak').shield>0);
});

test('装置效果不叠加：两个装置盖同一名干员只有一份屏障，每秒也只补一次',()=>{
 const {g,spot,cards,cathy}=session(['char_4162_cathy']);
 const dir=0;
 assert.equal(g.deploySummonCard(cards()[0].uid,spot.x,spot.y,dir),true);
 const front=g.map.grid[spot.y]?.[spot.x+1];
 if(front&&front.buildableType!=='NONE'&&!front.obstacle)assert.equal(g.deploySummonCard(cards()[1].uid,spot.x+1,spot.y,2),true,'第二个装置也盖住凯瑟琳');
 assert.equal(g.perform('start'),true,g.lastError||'');
 const b=g.battle,u=b.s.units.find(x=>x.id==='char_4162_cathy'),devices=b.s.summons.filter(s=>s.type==='cathy-device');
 assert.equal(devices.length,2,'两个装置都在场上');
 assert.equal(devices[0].anchorUid,u.uid);assert.equal(devices[1].anchorUid,u.uid);
 const cap=u.maxHp*0.2;
 assert.ok(Math.abs(u.shield-cap)<1e-6,'屏障总量＝上限，不是两份叠加（'+u.shield+' vs '+cap+'）');
 const layers=u.shieldLayers.filter(l=>String(l.id).startsWith('cathy-shield-'));
 assert.equal(layers.length,1,'同一名干员身上只有一份支援装置屏障');
 // 静默 5 秒后每秒补 6%：两个装置不会各补一次
 u.hp=u.maxHp;u.lastDamagedAt=-1e9;
 for(let i=0;i<30;i++)b.step();
 const after=b.s.units.find(x=>x.id==='char_4162_cathy').shield;
 assert.equal(after,cap,'已经顶到上限');
});

test('屏障被打掉后：5 秒静默窗口内不补，静默满 5 秒起每秒补 6%、不超过上限；二技能期间每秒无条件补',()=>{
 const run=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>20000)throw Error('时间未收敛');b.step();}};
 const dummy=(b)=>{b.s.queue=[];b.s.limit=1e9;b.s.enemies.push({uid:b.s.nextId++,id:'dummy',name:'dummy',x:-8,y:-8,hp:1e12,maxHp:1e12,atk:0,def:0,res:0,shield:0,shieldLayers:[],barriers:[],statuses:[],hidden:true,invulnerable:true,untargetable:true,trainingDummy:true,block:null,leak:1,interval:1,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,exitLife:null,flying:false});return b;};
 const setup=skillIndex=>{
  const {g,spot,near,cards}=session(['char_4162_cathy','char_199_yak']);
  if(skillIndex!=null)g.perform('skill',g.s.units.find(u=>u.charId==='char_4162_cathy').uid,skillIndex);
  assert.equal(g.deploySummonCard(cards()[0].uid,near.x,near.y,dirTo(near,spot)),true);
  assert.equal(g.perform('start'),true,g.lastError||'');
  const b=dummy(g.battle),yak=b.s.units.find(u=>u.id==='char_199_yak'),cathy=b.s.units.find(u=>u.id==='char_4162_cathy');
  return {b,yak,cathy};
 };
 // 一技能：静默窗口计时从「最后一次受击」算起
 const a=setup(0),cap=a.cathy.maxHp*0.2,each=a.cathy.maxHp*0.06;
 assert.ok(Math.abs(a.yak.shield-cap)<1e-6,'开局满盾');
 for(const l of a.yak.shieldLayers)l.remaining=100;a.yak.shield=100;a.yak.lastDamagedAt=0;
 run(a.b,4.9);assert.equal(a.yak.shield,100,'5 秒静默窗口内一身屏障都不补');
 run(a.b,6.1);assert.ok(Math.abs(a.yak.shield-(100+2*each))<1e-6,'静默满 5 秒后每秒补 6%（'+a.yak.shield.toFixed(1)+'）');
 run(a.b,20);assert.ok(Math.abs(a.yak.shield-cap)<1e-6,'补到天赋上限就停');
 // 二技能「战火淬炼」：改成每秒无条件补 6%
 const c=setup(1);
 for(const l of c.yak.shieldLayers)l.remaining=10;c.yak.shield=10;
 run(c.b,3.1);assert.ok(Math.abs(c.yak.shield-(10+3*each))<1e-6,'S2 每 1 秒补 maxHp×6%（'+c.yak.shield.toFixed(1)+'）');
 run(c.b,40);assert.ok(Math.abs(c.yak.shield-cap)<1e-6,'同样不超过天赋上限');
});
test('目标离开装置攻击范围后，旧目标身上那份屏障会被撤掉；一技能自身始终吃攻防加成',()=>{
 const {g,spot,near,cards,cathy,free}=session(['char_4162_cathy','char_199_yak']);
 g.perform('skill',cathy.uid,0);                                  // 一技能：自身 + 拥有装置屏障的干员
 assert.equal(g.deploySummonCard(cards()[0].uid,near.x,near.y,dirTo(near,spot)),true);
 assert.equal(g.perform('start'),true,g.lastError||'');
 const b=g.battle,yak=b.s.units.find(u=>u.id==='char_199_yak'),owner=b.s.units.find(u=>u.id==='char_4162_cathy');
 assert.ok(yak.shield>0);
 assert.ok(b.stats(owner).atk>b.profile(owner).attributes.atk,'「自身」无条件吃攻防加成');
 assert.ok(b.stats(yak).atk>b.profile(yak).attributes.atk,'拿到屏障的干员也吃');
 // 把同伴挪到装置范围之外（离装置最近的可部署格都超过 1 格）→ 装置改锁范围内的人，旧目标那份撤掉
 const far=free.slice().sort((p,q)=>(Math.abs(q.x-near.x)+Math.abs(q.y-near.y))-(Math.abs(p.x-near.x)+Math.abs(p.y-near.y)))[0];
 assert.ok(Math.abs(far.x-near.x)+Math.abs(far.y-near.y)>1,'需要一块远处的空格');
 teleportActor(b,yak,{x:far.x,y:far.y});
 for(let i=0;i<3;i++)b.step();
 assert.equal(yak.shieldLayers.find(l=>String(l.id).startsWith('cathy-shield-')),undefined,'离开范围后不再保留支援装置屏障');
});

test('屏障数值取 token 天赋黑板；装置随凯瑟琳离场一起消失',()=>{
 const {g,cards,cathy}=session(['char_4162_cathy']);
 const values=cathyDeviceValues({data,profile:()=>({status:data.profiles['chess_char_4_11_a'].status,modulePhase:null})},cathy);
 assert.deepEqual(values,{capRatio:.2,eachRatio:.06,interval:1,quiet:5},'精英2 档：20% / 6% / 1 秒 / 5 秒静默');
 // 精锐形态带模组 uniequip_002_cathy：持有上限 +1（携带 4 个），部署费用 -2
 const elite=session(['char_4162_cathy']);elite.g.s.units[0].chessId='chess_char_4_11_b';
 assert.equal(elite.g.summonCardSpecs(elite.g.s.units[0]).find(s=>s.type==='cathy-device').count,4);
 // 凯瑟琳离场 → 附属装置与卡一起消失
 assert.equal(g.perform('withdraw',cathy.uid),true);
 assert.equal(g.s.summonCards.some(c=>c.type==='cathy-device'),false,'持有者撤走后不再有装置卡');
});
