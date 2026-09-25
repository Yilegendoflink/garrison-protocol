import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 同名牌统一技能（用户 2026-09-22 口径）：同一名干员（按 charId 归并，精锐与初始算同一名）的副本
// 必须用同一个技能——在场上的所有副本技能始终一致，改其中任意一张就把其余副本一起改。
const newSession=()=>new NativeSession(data,{bondBan:NO_BOND_BAN,seed:3});
const skillsOf=u=>data.profiles[u.chessId]?.skillChoices?.map(c=>c.skill?.name)||[];
const effective=u=>skillsOf(u)[u.skillIndex??0];
const sample=Object.values(data.season.charShopChessDatas).find(s=>s.charId&&s.goldenChessId&&(data.profiles[s.chessId]?.skillChoices?.length||0)>=2);
const other=Object.values(data.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden&&s.charId!==sample.charId&&(data.profiles[s.chessId]?.skillChoices?.length||0)>=2);

function place(g,uid){
 for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++)if(g.canDeploy(uid,x,y)&&g.deploy(uid,x,y,0))return {x,y};
 throw new Error('no tile');
}

test('改一张同名牌，场上与整备区的副本一起改（技能始终一致）',()=>{
 const g=newSession();
 const field=g.gain(sample.chessId),bench=g.gain(sample.chessId);
 assert.equal(g.s.units.length,2,'两张同名卡不会被三合一');
 place(g,field.uid);
 assert.deepEqual(bench.position,null,'第二张留在整备区');
 assert.equal(field.skillIndex,undefined);assert.equal(bench.skillIndex,undefined,'初始都跟随档案默认档');
 // 改整备区那张 → 场上的那张也要跟着变（用户报的就是这种不一致）。
 assert.equal(g.perform('skill',bench.uid,1),true);
 assert.equal(bench.skillIndex,1);
 assert.equal(field.skillIndex,1,'场上同名干员必须同步');
 assert.equal(effective(field),skillsOf(field)[1]);
 assert.equal(effective(field),effective(bench),'两张卡的生效技能必须一致');
 // 反过来改场上的那张 → 整备区那张跟着变。
 assert.equal(g.perform('skill',field.uid,0),true);
 assert.equal(field.skillIndex,0);assert.equal(bench.skillIndex,0);
 // 三张同名卡会合成精锐：精锐与初始是同一名干员，也要一起改。
 const golden=g.gain(sample.chessId);
 assert.equal(golden.chessId,sample.goldenChessId,'三张合成精锐');
 assert.equal(g.s.units.filter(u=>u.charId===sample.charId).length,1,'三张合一后只剩精锐');
 // 再补两张初始形态（不会和精锐合并），现在场上同时有精锐与初始。
 const extra1=g.gain(sample.chessId),extra2=g.gain(sample.chessId);
 assert.equal(g.s.units.filter(u=>u.charId===sample.charId).length,3,'精锐 ＋ 两张初始');
 assert.equal(g.perform('skill',extra1.uid,1),true);
 for(const u of g.s.units.filter(u=>u.charId===sample.charId))assert.equal(u.skillIndex,1,`${u.chessId} 必须和同名干员一致`);
 assert.equal(golden.skillIndex,1,'精锐形态也要跟着改');
 assert.equal(extra2.skillIndex,1);
});

test('不同干员互不影响，非法档位不改任何东西',()=>{
 const g=newSession();
 const a=g.gain(sample.chessId),b=g.gain(other.chessId),a2=g.gain(sample.chessId);
 place(g,a.uid);place(g,a2.uid);
 assert.notEqual(sample.charId,other.charId);
 assert.equal(g.perform('skill',b.uid,1),true);
 assert.equal(b.skillIndex,1);
 assert.equal(a.skillIndex,undefined,'别的干员不能被带上');
 assert.equal(a2.skillIndex,undefined);
 // 越界档位：整组都不动。
 assert.equal(g.perform('skill',a.uid,9),false);
 assert.equal(a.skillIndex,undefined);assert.equal(a2.skillIndex,undefined);
 assert.equal(b.skillIndex,1,'失败的命令不能改动任何单位');
 // 战斗中不能改技能（原有限制保持不变）。
 g.s.phase='battle';
 assert.equal(g.perform('skill',a.uid,1),false);
 assert.equal(a.skillIndex,undefined);
});

test('同步只写进档案里真实存在的档位',()=>{
 const g=newSession();
 // 隐现（样本）只有 2 档技能：第 3 档（index 2）对他无效。
 const u=g.gain(sample.chessId);
 assert.equal(skillsOf(u).length,2);
 assert.equal(g.perform('skill',u.uid,2),false);
 assert.equal(u.skillIndex,undefined);
 assert.equal(g.perform('skill',u.uid,1),true);
 assert.equal(u.skillIndex,1);
});
