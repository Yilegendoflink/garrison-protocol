import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {bondIds,bondIsCore,singleCoreBondBan,bondBanBriefingHtml,bannedOperatorsHtml} from '../dist/native-bond-ban.js';
import {weeklyChallengeAt,weeklyChallengeSnapshot,validateWeeklyChallengeSchedule} from '../dist/native-challenges.js';

const core=bondIds(data).filter(id=>bondIsCore(data,id)),extra=bondIds(data).filter(id=>!bondIsCore(data,id));
const entry=data.weeklyChallenges.entries.find(e=>e.challengeId==='single-core');
const weeklyChallenge=weeklyChallengeSnapshot(entry,Date.parse(entry.startsAt));

test('接续狼沙异变，连续两周',()=>{
 const start=Date.parse(entry.startsAt),end=Date.parse(entry.endsAt);
 assert.deepEqual(validateWeeklyChallengeSchedule(data.weeklyChallenges),[]);
 assert.equal(entry.startsAt,'2026-11-18T00:00:00+08:00');assert.equal(end-start,14*86400000);
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,start-1).challengeId,'regional-rework');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,start).id,entry.id);
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,end),null);
});

test('每个种子只保留一个核心；所有核心均可抽中，简报逐项显示全部附加盟约',()=>{
 const selected=new Set();
 for(let i=0;i<128;i++){
  const seed=(i*0x9e3779b9)>>>0,ban=singleCoreBondBan(data,seed),kept=core.filter(id=>!ban.bonds.includes(id));
  assert.deepEqual(singleCoreBondBan(data,seed),ban);assert.equal(kept.length,1);assert.equal(ban.bonds.length,core.length-1);
  assert.ok(extra.every(id=>!ban.bonds.includes(id)));selected.add(kept[0]);
 }
 assert.deepEqual([...selected].sort(),core.slice().sort());
 const ban=singleCoreBondBan(data,42),html=bondBanBriefingHtml(data,ban,{singleCore:true});
 assert.equal((html.match(/available core/g)||[]).length,1);assert.equal((html.match(/available extra/g)||[]).length,extra.length);
 assert.match(bannedOperatorsHtml(data,ban,{singleCore:true}),/全部附加盟约保留/);
});

test('简报结果进入本局与读档；缺席核心不计人数、不激活、不加层，保留有附加归属的干员',()=>{
 const ban=singleCoreBondBan(data,42),kept=core.find(id=>!ban.bonds.includes(id)),absent=ban.bonds[0];
 const g=new NativeSession(data,{seed:24,weeklyChallenge,bondBan:ban,bandId:'band_sees'});
 assert.deepEqual(g.s.bondBan.bonds,ban.bonds);
 const roster=Object.values(data.season.charShopChessDatas).filter(row=>row.charId&&!row.isHidden).map(row=>row.chessId);
 const overlap=roster.find(id=>{const bonds=g.operatorBonds(id);return bonds.includes(absent)&&bonds.some(id=>extra.includes(id));});
 assert.ok(overlap);assert.equal(g.bondBanned(overlap),false);
 const banned=roster.find(id=>g.bondBanned(id));assert.ok(banned);assert.ok(!g.eligible().some(row=>row.chessId===banned));assert.equal(g.gain(banned),null);
 const restored=NativeSession.restore(data,g.snapshot());assert.ok(restored);assert.deepEqual(restored.s.bondBan.bonds,ban.bonds);
 const incorrect=structuredClone(g.snapshot());incorrect.s.bondBan.bonds.pop();assert.equal(NativeSession.restore(data,incorrect),null);
 const indexed=Object.values(data.season.charShopChessDatas).find(row=>row.charId&&!row.isHidden);
 g.s.units=Array.from({length:6},(_,i)=>({chessId:indexed.chessId,charId:'probe'+i,position:{x:i,y:0},bondIds:[kept,absent,'swiftShip','seesShip']}));
 const rows=g.bonds();assert.equal(rows[kept].active,true);assert.equal(rows.swiftShip.active,true);
 assert.deepEqual(rows[absent],{count:0,rawCount:0,active:false});assert.equal(rows.seesShip.active,false);
 g.addLayers(absent,5,false);assert.equal(g.s.bondLayers[absent]||0,0);
 const custom={bonds:['swiftShip'],always:['swiftShip'],never:core};
 const fromChallenge=new NativeSession(data,{seed:42,weeklyChallenge,bondBan:custom});assert.deepEqual(fromChallenge.s.bondBan,ban);
 const normal=new NativeSession(data,{seed:42,bondBan:custom});assert.deepEqual(normal.s.bondBan.bonds,['swiftShip']);
});
