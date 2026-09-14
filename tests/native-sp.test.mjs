import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {spTypeOf,usesSp,skillKind,ammoCount,spIncrement,initSpOf,spCap,gainSp,tickTimeSp,spBarFill} from '../dist/native-sp.js';
import {resolveChess} from '../dist/protocol.js';

const source=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));
const base=JSON.parse(fs.readFileSync('data/normalized/allianceLower.json','utf8'));
const skill=(spData,extra={})=>({spData,duration:0,...extra});
const unit=(sp=0)=>({sp,spCd:0,spLock:0,skillLeft:0,ammo:0});

test('time recover ticks integer increment after one period',()=>{
 const sk=skill({spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,increment:1,maxChargeTime:1});
 const u=unit(0);
 assert.equal(tickTimeSp(u,sk,.99,1),0);assert.equal(u.sp,0);assert.ok(Number.isInteger(u.sp));
 assert.equal(tickTimeSp(u,sk,.01,1),1);assert.equal(u.sp,1);
 assert.equal(tickTimeSp(u,sk,2,1),2);assert.equal(u.sp,3);assert.ok(Number.isInteger(u.sp));
});

test('increment comes from skill data, not a hardcoded +1',()=>{
 const sk=skill({spType:'INCREASE_WITH_TIME',spCost:20,initSp:0,increment:3,maxChargeTime:1});
 const u=unit(0);
 assert.equal(spIncrement(sk),3);
 assert.equal(tickTimeSp(u,sk,1,1),3);assert.equal(u.sp,3);
});

test('full bar and block freeze leftover cooldown',()=>{
 const sk=skill({spType:'INCREASE_WITH_TIME',spCost:2,initSp:0,increment:1,maxChargeTime:1});
 const u=unit(0);
 tickTimeSp(u,sk,2,1);assert.equal(u.sp,2);
 const leftover=u.spCd=.4;
 tickTimeSp(u,sk,5,1);assert.equal(u.sp,2);assert.equal(u.spCd,leftover);
 u.sp=0;u.skillLeft=1;
 tickTimeSp(u,sk,5,1);assert.equal(u.sp,0);assert.equal(u.spCd,leftover);
});

test('taken-damage recover is blocked during skill',()=>{
 const sk=skill({spType:'INCREASE_WHEN_TAKEN_DAMAGE',spCost:8,initSp:0,increment:1,maxChargeTime:1});
 const u=unit(0);
 assert.equal(gainSp(u,sk),1);assert.equal(u.sp,1);
 u.skillLeft=3;
 assert.equal(gainSp(u,sk),0);assert.equal(u.sp,1);
});

test('charge cap stores multiple costs and spend leaves leftover',()=>{
 const sk=skill({spType:'INCREASE_WITH_TIME',spCost:5,initSp:0,increment:1,maxChargeTime:2});
 const u=unit(0);
 assert.equal(spCap(sk),10);
 for(let i=0;i<12;i++)gainSp(u,sk);
 assert.equal(u.sp,10);
 u.sp-=5;assert.equal(u.sp,5);
});

test('passive and zero-cost skills skip the SP bar',()=>{
 const passive=skill({spType:8,spCost:0,initSp:0,increment:0,maxChargeTime:0});
 assert.equal(spTypeOf(passive),'PASSIVE');
 assert.equal(usesSp(passive),false);
 assert.equal(spCap(passive),0);
 assert.equal(spBarFill(unit(0),passive,0),null);
});

test('instant skill bar snaps empty; duration bar drains to 0; ammo uses cells',()=>{
 const instant=skill({spType:'INCREASE_WITH_TIME',spCost:10,initSp:0,increment:1,maxChargeTime:1});
 const u=unit(10);u.sp=0;
 assert.equal(skillKind(instant),'instant');
 const empty=spBarFill(u,instant,10);
 assert.equal(empty.kind,'idle');assert.equal(empty.ratio,0);assert.equal(empty.on,false);
 const dur=skill({spType:'INCREASE_WITH_TIME',spCost:20,initSp:0,increment:1,maxChargeTime:1},{duration:8});
 const v=unit(0);v.skillLeft=8;
 assert.equal(skillKind(dur),'duration');
 assert.equal(spBarFill(v,dur,20).ratio,1);
 v.skillLeft=4;assert.equal(spBarFill(v,dur,20).ratio,.5);
 v.skillLeft=0;assert.equal(spBarFill(v,dur,20).ratio,0);
 const ammo=skill({spType:'INCREASE_WHEN_ATTACK',spCost:14,initSp:0,increment:1,maxChargeTime:1},{duration:0,durationType:'AMMO',blackboard:[{key:'attack@trigger_time',value:4}]});
 const w=unit(0);w.ammo=4;w.ammoMax=4;
 assert.equal(skillKind(ammo),'ammo');assert.equal(ammoCount(ammo),4);
 const cells=spBarFill(w,ammo,14);
 assert.equal(cells.kind,'ammo');assert.equal(cells.cells,4);assert.equal(cells.filled,4);
 w.ammo=1;assert.equal(spBarFill(w,ammo,14).filled,1);
 w.ammo=0;assert.equal(spBarFill(w,ammo,14).kind,'idle');assert.equal(spBarFill(w,ammo,14).on,false);
});

test('resolved chess skills match allianceLower skill levels',()=>{
 const samples=[
  ['chess_char_1_02_a',0,'INCREASE_WITH_TIME'],
  ['chess_char_1_01_a',0,'INCREASE_WHEN_ATTACK'],
  ['chess_char_1_12_a',1,'INCREASE_WHEN_TAKEN_DAMAGE'],
  ['chess_char_1_07_a',0,'PASSIVE']
 ];
 for(const [chessId,skillIndex,type] of samples){
  const row=resolveChess(source,base,chessId,{skillIndex});
  const chess=source.season.charChessDataDict[chessId];
  const shop=source.season.charShopChessDatas[row.normalId];
  const entity=base.entities[shop.tmplId||shop.charId];
  const ref=entity.skillRefs[skillIndex];
  const raw=base.skills[ref.skillId].levels[Math.min(chess.status.skillLevel-1,base.skills[ref.skillId].levels.length-1)].spData;
  assert.equal(spTypeOf(row.skill),type);
  assert.equal(row.skill.spData.spType,raw.spType);
  assert.equal(row.skill.spData.spCost,raw.spCost);
  assert.equal(row.skill.spData.initSp,raw.initSp);
  assert.equal(row.skill.spData.increment,raw.increment);
  assert.equal(initSpOf(row.skill),raw.initSp);
 }
 const a=resolveChess(source,base,'chess_char_1_01_a',{skillIndex:0});
 const b=resolveChess(source,base,'chess_char_1_01_a',{skillIndex:1});
 assert.notEqual(a.skill.spData.spCost,b.skill.spData.spCost);
 assert.notEqual(spTypeOf(a.skill),spTypeOf(b.skill));
 assert.equal(skillKind(a.skill),'ammo');
 assert.equal(ammoCount(a.skill),4);
 assert.equal(skillKind(b.skill),'ammo');
});
