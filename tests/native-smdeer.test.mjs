import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {dealDamage,applyElementDamage} from '../dist/native-effects.js';

// boss_7 “萨米的意志”（enemy_9033_acdeer）＝最终战逐名实装回归。
// 口径：PRTS 敌人页（级别0）＋本期 h07_07_s 覆盖，见 dist/native-enemy-skills.js 的 tickSmdeer 注释。
// 注意：s.events 会被裁剪，长时窗的事件断言用增量收集。

function game({operator=0,seed=42}={}){
 const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId:NATIVE_DATA.maps[0].stageId,seed,bondBan:{bonds:[]},finalBossId:'boss_7'});
 g.s.rewardPending=null;g.s.rewardQueue=[];
 g.s.round=buildPhasePlan(NATIVE_DATA,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;
 if(operator){
  g.s.funds=99999;
  const entry=Object.values(NATIVE_DATA.season.charShopChessDatas).find(x=>x.charId&&!x.isHidden&&NATIVE_DATA.profiles[x.chessId]?.rangeId==='0-1');
  // canDeploy 对「未部署干员踩已占格」是换位语义：多干员测试必须显式避开已占格，
  // 否则第二张卡会把第一张挤回整备区（battle units 就只剩一个）。
  const occupied=[];
  for(let k=0;k<operator;k++){
   const u=g.gain(entry.chessId);
   assert.ok(u,'gain '+entry.chessId);
   let placed=false;
   for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
    if(occupied.some(p=>p.x===x&&p.y===y))continue;
    if(g.canDeploy(u.uid,x,y)&&g.deploy(u.uid,x,y,0)){occupied.push({x,y});placed=true;}
   }
   assert.ok(placed,'deploy '+entry.chessId);
  }
 }
 // 「三合一」奖励挂起会挡住 beginBattle；测试不消费奖励。
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.ok(g.startBattle(),g.lastError||'boss_7 battle failed to start');
 return g;
}
const bossOf=g=>g.battle.s.enemies.find(e=>e.finalBoss);
// 步进并增量收集 strike/技能事件（s.events 会裁剪旧事件，不能事后一次取）。
function steps(b,seconds,seen=[]){
 for(let i=0,n=Math.round(seconds*30);i<n;i++){
  b.step();
  for(const e of b.s.events)if((e.type==='strike'&&e.style==='ice-spike')||e.type==='enemy-skill-start')if(!seen.includes(e))seen.push(e);
 }
 return seen;
}

test('巨型受击矩形：格心落在 4.95×2.95 上移1 矩形内的射程格即可选中本体',()=>{
 const g=game({operator:1}),b=g.battle,boss=bossOf(g),u=b.s.units[0];
 assert.equal(boss.x,g.map.cols-1,'Boss 中心锚定最右列格心');
 const rect=b.hitAreaOf(boss);
 assert.ok(Math.abs(rect.right-rect.left-4.95)<1e-9&&Math.abs(rect.bottom-rect.top-2.95)<1e-9);
 assert.ok(rect.top<boss.y-1&&rect.bottom>boss.y,'矩形向上偏移 1');
 // 近战「0-1」射程只含自身格。用实际棋盘上预留区左侧两格作攻击点，
 // 避免用不可达的地图外格验证矩形；再往左一格应超出受击区域。
 u.x=g.map.cols-3;u.y=0;
 assert.ok(b.targets(u).some(e=>e.uid===boss.uid),'地图内预留区左侧的格子经矩形选中');
 u.x=g.map.cols-4;u.y=0;
 assert.ok(!b.targets(u).some(e=>e.uid===boss.uid),'再向左一格超出矩形');
});

test('冰凌：普攻选中目标所在列并自最上方每0.2秒落下，物理伤害只落在该列',()=>{
 const g=game({operator:2}),b=g.battle,boss=bossOf(g);
 const [inCol,outCol]=b.s.units;
 const columnX=Math.max(1,Math.min(g.map.cols-2,Math.round(boss.x)+2));
 const rowY=Math.max(1,Math.round(boss.y)-3);
 inCol.x=columnX;inCol.y=rowY;
 outCol.x=Math.max(0,columnX-2);outCol.y=rowY;
 const hpIn=inCol.hp,hpOut=outCol.hp;
 const seen=steps(b,5.5); // 只覆盖第一次攻击（下一次在 6 秒后），避免第二轮风暴混入断言
 const strikes=seen.filter(e=>e.type==='strike'&&e.style==='ice-spike');
 assert.ok(strikes.length>=7,'冰凌逐行都有 strike 表现事件（实际 '+strikes.length+'）');
 const columns=new Set(strikes.map(e=>e.targetX));
 assert.equal(columns.size,1,'普攻冰凌只打目标所在一列（实际 '+[...columns].join(',')+'）');
 const column=[...columns][0];
 assert.ok(strikes.every(e=>e.targetX===column));
 const rows=strikes.map(e=>e.targetY);
 assert.deepEqual(rows,[...rows].sort((a,b)=>a-b),'同一列自上而下按行推进');
 const hitOp=column===columnX?inCol:outCol,missOp=column===columnX?outCol:inCol,beforeHit=column===columnX?hpIn:hpOut,beforeMiss=column===columnX?hpOut:hpIn;
 assert.ok(hitOp.hp<beforeHit,'列内目标被冰凌命中');
 assert.equal(missOp.hp,beforeMiss,'列外目标不受伤害');
 assert.equal(strikes.filter(e=>e.targetY===rowY&&e.hit>0).length,1,'每个格子每轮只落一枚，命中行恰好一次');
});

test('自然涌动：40/60 秒 CD，单目标晕眩 10 秒并每秒承受 20% 攻击力法伤',()=>{
 const g=game({operator:1}),b=g.battle,boss=bossOf(g),u=b.s.units[0];
 const lasso=boss.enemySkills.find(s=>s.prefab==='Lasso');
 assert.ok(lasso&&lasso.initCooldown===40&&lasso.cooldown===60,'CD 读本期黑板 40/60');
 lasso.nextAt=0;boss.attackCooldown=0;
 steps(b,1/15);
 assert.ok(boss.enemyCast?.lasso,'自然涌动开始施法');
 assert.ok(u.statuses.some(s=>s.kind==='stun'),'目标被晕眩');
 const duration=boss.enemyCast.endsAt-b.s.time;
 assert.ok(duration>9&&duration<=10,'晕眩/持续 10 秒（实际 '+duration.toFixed(2)+'）');
 const hpAtCast=u.hp,oneTick=b.s.time+1;
 while(b.s.time<oneTick)b.step();
 const skillDamage=hpAtCast-u.hp;
 assert.ok(skillDamage>0&&skillDamage<=boss.atk*.2+1,'单跳约 20% 攻击力（实际 '+skillDamage.toFixed(1)+'）');
 const castEnd=boss.enemyCast.endsAt;
 while(b.s.time<castEnd+.5)b.step();
 assert.ok(!boss.enemyCast,'10 秒后施法结束');
});

test('半血：物理/法术伤害降低60%，真伤与元素损伤不跟减',()=>{
 const g=game({operator:1}),b=g.battle,boss=bossOf(g),u=b.s.units[0];
 dealDamage(b,{source:u,target:boss,value:1000,type:'physical'});
 assert.equal(boss.maxHp-boss.hp,1000,'满血时物理伤害不减免');
 boss.hp=boss.maxHp*.4; // 进入半血
 const hpSet=boss.hp;
 dealDamage(b,{source:u,target:boss,value:1000,type:'physical'});
 assert.ok(Math.abs(hpSet-boss.hp-400)<1e-6,'物理伤害只剩 40%（实际 '+(hpSet-boss.hp)+'）');
 dealDamage(b,{source:u,target:boss,value:1000,type:'true'});
 assert.ok(Math.abs(hpSet-boss.hp-1400)<1e-6,'真伤不跟减（实际 '+(hpSet-boss.hp-400)+'）');
 boss.hp=boss.maxHp*.4;
 const before=boss.elemental?.burn||0;
 applyElementDamage(b,{source:u,target:boss,amount:500,type:'burn',cause:'test'});
 assert.equal((boss.elemental?.burn||0)-before,500,'元素损伤不跟减');
});

test('半血普攻额外选一条不同的列',()=>{
 const g=game({operator:2}),b=g.battle,boss=bossOf(g);
 const [a,c]=b.s.units;
 const rowY=Math.max(1,Math.round(boss.y)-3);
 a.x=Math.max(0,Math.min(g.map.cols-1,Math.round(boss.x)+2));a.y=rowY;
 c.x=Math.max(0,Math.min(g.map.cols-1,Math.round(boss.x)-2));c.y=rowY;
 assert.notEqual(a.x,c.x,'两名目标异列');
 boss.hp=boss.maxHp*.4;
 const seen=steps(b,7);
 const columns=new Set(seen.filter(e=>e.type==='strike'&&e.style==='ice-spike').map(e=>e.targetX));
 assert.ok(columns.size>=2,'半血后冰凌覆盖两条不同列（实际 '+[...columns].join(',')+'）');
});

test('Doom 999/999 秒不被逐名 tick 施放；读档后逐名状态保留',()=>{
 const g=game({operator:1}),b=g.battle,boss=bossOf(g);
 const doom=boss.enemySkills.find(s=>s.prefab==='Doom');
 assert.ok(doom&&doom.initCooldown===999&&doom.cooldown===999,'Doom 读本期 999/999');
 doom.nextAt=0; // 强行就绪：逐名 tick 也绝不能放它
 boss.enemySkills.find(s=>s.prefab==='Lasso').nextAt=Infinity;
 for(let i=0;i<120;i++)b.step();
 assert.ok(!b.s.events.some(e=>e.type==='enemy-skill-start'&&e.skill==='Doom'),'Doom 未被施放');
 const saved=g.snapshot();
 const restored=NativeSession.restore(NATIVE_DATA,saved);
 assert.ok(restored);
 const rBoss=restored.battle.s.enemies.find(e=>e.finalBoss);
 assert.equal(rBoss.id,'enemy_9033_acdeer');
 assert.equal(rBoss.madnessResist,boss.madnessResist);
 assert.equal(rBoss.hitRect.length,4.95);
 assert.equal(rBoss.hitRect.width,2.95);
 assert.equal(rBoss.hitRect.offsetY,1);
 assert.equal(rBoss.hp,boss.hp);
 assert.ok(rBoss.formHold,'读档后仍自缚');
});
