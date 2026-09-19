import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {drawConcealOverlay,concealActive} from '../dist/native-fx.js';
import {commitExit} from '../dist/native-effects.js';

// 隐匿（INVISIBLE）：统一口径是「不能被不同阵营选中」，被阻挡即视为脱离隐匿；
// 表现层给我方与敌方都套暗灰色滤镜 + 马赛克。计划与后续项见 INVISIBILITY_PLAN.md。
const chessOf=charId=>Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId===charId&&!s.isHidden).chessId;
function liveBattle(charIds){
 const g=new NativeSession(NATIVE_DATA,{seed:9});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 const units=charIds.map(id=>g.gain(chessOf(id)));
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of units){
  let placed=false;
  for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
   if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;
   if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
  }
  assert.ok(placed,'干员需要落场');
 }
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 return b;
}
function probe(b,x,y,extra={}){
 const e={uid:910000+b.s.enemies.length,id:'probe',name:'probe',x,y,hp:100000,maxHp:100000,atk:10,def:0,res:0,
  statuses:[],hidden:false,invulnerable:false,untargetable:false,block:null,leak:1,interval:1,attackSpeed:100,
  attackCooldown:0,action:null,deployGen:0,exitLife:null,flying:false,route:null,cmd:0,invisible:false,ranged:false,canAttack:true,range:0,...extra};
 b.s.enemies.push(e);return e;
}
function host(){
 const ops=[];
 const c={globalCompositeOperation:'source-over',strokeStyle:'',fillStyle:'',lineWidth:1,imageSmoothingEnabled:true,
  save(){},restore(){},createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
  fillRect(...a){ops.push({op:'fillRect',args:a,style:this.fillStyle});},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},
  closePath(){},stroke(){},arc(){},ellipse(){},fill(){},translate(){},rotate(){},drawImage(){ops.push({op:'drawImage'});},
  fillText(){},setLineDash(){}};
 return {c,ops};
}

test('隐匿敌人未被阻挡时别人选不中，被别人阻挡后视为脱离隐匿',()=>{
 const b=liveBattle(['char_469_indigo','char_498_inside']);
 const blocker=b.s.units[0],other=b.s.units[1];
 other.x=blocker.x+1;other.y=blocker.y;
 const e=probe(b,other.x+1,other.y,{invisible:true});
 assert.ok(b.inside(other,e),'测试布局要让观察者干员在射程内');
 assert.equal(b.targets(other).some(x=>x.uid===e.uid),false,'隐匿且未被阻挡时无法被索敌');
 e.block=blocker.uid;
 assert.equal(b.targets(other).some(x=>x.uid===e.uid),true,'被别人阻挡后其他人也能打');
 e.invisible=false;
 assert.equal(b.targets(other).some(x=>x.uid===e.uid),true,'本来就不隐匿的单位不受影响');
});

test('隐匿马赛克：我方与敌方都画灰色滤镜 + 马赛克块，reduceFx 下不流动',()=>{
 const box={x:10,y:10,w:40,h:40},ally={invisible:true,statuses:[]},foe={invisible:true,statuses:[],flying:false};
 for(const actor of [ally,foe]){
  const h=host();
  assert.equal(concealActive(actor),true,'隐匿中的单位（含我方）应命中判定');
  assert.equal(drawConcealOverlay(h.c,actor,box,{time:0}),true,'隐匿单位要画马赛克');
  assert.ok(h.ops.some(o=>/rgba\(110,118,126/.test(String(o.style))),'要有一层灰色滤镜');
  assert.ok(h.ops.filter(o=>o.op==='fillRect').length>4,'要有马赛克块');
 }
 const plain=host(),hidden=host();
 assert.equal(drawConcealOverlay(plain.c,{invisible:false,statuses:[]},box,{time:0}),false,'不隐匿不画');
 assert.equal(drawConcealOverlay(hidden.c,{invisible:true,hidden:true},box,{time:0}),false,'已从场上消失的单位不画');
 const a=host(),c2=host();
 drawConcealOverlay(a.c,ally,box,{time:0,reduceFx:true});
 drawConcealOverlay(c2.c,ally,box,{time:1.7,reduceFx:true});
 assert.deepEqual(c2.ops,a.ops,'动效关闭时马赛克不流动');
});

// 用真实敌人数据落场（隐形/山海众这类自带隐匿的单位）
function spawnReal(b,id,x,y){
 const origin=b.map.origin||{col:0,row:0},spot={col:x+origin.col,row:origin.row-y};
 b.level={...(b.level||{}),routes:[{motionMode:'WALK',startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...(b.level?.enemyProfiles||{}),[id]:NATIVE_DATA.enemies[id]}};
 b.spawn({id,route:0});
 return b.s.enemies.at(-1);
}

test('敌人自带的隐匿不会被状态表抹掉，攻击显形后 6 秒会重新隐匿',()=>{
 const b=liveBattle(['char_498_inside']),u=b.s.units[0];
 const e=spawnReal(b,'enemy_1299_ymkilr',u.x+1,u.y);
 assert.equal(e.invisible,true,'山海众头目出场即隐匿');
 b.step();
 assert.equal(e.invisible,true,'初始隐匿必须能撑过第一帧（此前会被 tickStatuses 清掉）');
 b.resolveEnemyStrike(e,u,{});
 assert.equal(e.invisible,false,'攻击后显形');
 assert.ok(e.invisibleRecoverAt>b.s.time,'停手 6 秒后重新隐匿');
 for(let i=0;i<200;i++)b.step();
 assert.equal(e.invisible,true,'6 秒后恢复隐匿');
});

test('隐匿的我方不会被敌方远程索敌，正在阻挡它的敌人照打',()=>{
 const b=liveBattle(['char_469_indigo','char_498_inside']);
 const blocker=b.s.units[0],hidden=b.s.units[1];
 blocker.x=3;blocker.y=0;hidden.x=2;hidden.y=0;
 hidden.statuses.push({kind:'invisible',remaining:30,source:1,value:1});
 hidden.invisible=true;
 const foe=probe(b,5,0,{ranged:true,range:9,interval:1,canAttack:true});
 for(let i=0;i<5;i++)b.step();
 assert.notEqual(foe.action?.target,hidden.uid,'远程敌人不能选隐匿中的干员');
 // 贴上去形成阻挡：隐匿不阻止阻挡，正在阻挡它的敌人仍然能打它
 foe.x=hidden.x;foe.y=hidden.y;
 b.step();
 assert.equal(foe.block,hidden.uid,'隐匿单位照常阻挡敌人');
 const hp=hidden.hp;let sawTarget=false;
 for(let i=0;i<60;i++){b.step();if(foe.action?.target===hidden.uid)sawTarget=true;}
 assert.ok(sawTarget,'阻挡它的敌人锁定的是它');
 assert.ok(hidden.hp<hp,'被阻挡的隐匿干员照样挨打');
});

test('银灰的鹰眼视觉只在自己攻击范围内反隐，离开范围后恢复隐匿',()=>{
 const b=liveBattle(['char_172_svrash']),silver=b.s.units[0];
 const near=probe(b,silver.x+1,silver.y,{invisible:true}),far=probe(b,silver.x+8,silver.y,{invisible:true});
 for(let i=0;i<4;i++)b.step();
 assert.equal(near.revealed,true,'射程内的隐匿被反隐');
 assert.equal(far.revealed,false,'射程外不受影响');
 near.x=silver.x+8;
 for(let i=0;i<20;i++)b.step();
 assert.equal(near.revealed,false,'走出射程后隐匿恢复（反隐窗口自动过期）');
});

test('伊内丝撤退后影哨留在原地继续反隐与减速',()=>{
 const b=liveBattle(['char_4087_ines']),ines=b.s.units[0];
 const near=probe(b,ines.x+1,ines.y,{invisible:true});
 for(let i=0;i<4;i++)b.step();
 assert.equal(near.revealed,true,'在攻击范围内的隐匿失效');
 assert.ok(near.statuses.some(s=>s.kind==='sluggish'),'同时被减速');
 commitExit(b,{target:ines,reason:'retreat'});
 b.step();
 assert.equal((b.s.revealSentries||[]).length,1,'撤退后留下 1 个影哨');
 for(let i=0;i<10;i++)b.step();
 assert.equal(near.revealed,true,'影哨让反隐继续生效');
 near.x=ines.x+9;near.y=ines.y;
 for(let i=0;i<20;i++)b.step();
 assert.equal(near.revealed,false,'离开影哨范围后恢复隐匿');
});

