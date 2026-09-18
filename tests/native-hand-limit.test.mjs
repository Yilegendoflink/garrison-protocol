import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {HAND_LIMIT} from '../dist/protocol.js';

function prep(session){session.s.phase='prep';session.s.rewardPending=null;session.s.rewardQueue=[];session.s.funds=9999;return session;}
function handUnit(uid,chessId){const profile=NATIVE_DATA.profiles[chessId];return {uid,chessId,charId:profile.charId,rank:profile.rank,position:null,dir:0,equipment:[]};}
const sampleIds=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId).map(s=>s.chessId);
// 用互不相同、且不在货架上的干员填满整备区，避免误触「第三张同名卡」的三合一例外。
function fillHand(g,count,{chessId=null,ownerUid=1}={}){const offers=new Set(g.s.offers.filter(Boolean));const pool=sampleIds.filter(id=>!offers.has(id));const pick=i=>chessId??pool[i%pool.length];g.s.units=Array.from({length:count},(_,i)=>handUnit(ownerUid+i,pick(i)));g.s.seq=ownerUid+count+100;g.s.items=[];return g;}
function firstItemId(){return Object.keys(NATIVE_DATA.season.trapChessDataDict)[0];}
function summonSession(){const g=prep(new NativeSession(NATIVE_DATA,{seed:1}));g.s.capacity=16;g.s.units=[];g.gain('chess_char_2_02_b');const owner=g.s.units[0];let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(owner.uid,x,y))placed=g.deploy(owner.uid,x,y,0);assert.ok(placed,'医疗无人机持有者需要落场');const card=g.s.summonCards?.find(c=>c.type==='silent-drone');assert.ok(card,'技能召唤卡应出现在整备区');return {g,card,ownerUid:owner.uid};}

test('整备区上限统计干员、装备与未放置的召唤物卡',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:1});
 assert.equal(g.handLength(),0);
 g.s.units=[handUnit(1,g.s.offers.find(Boolean))];
 g.s.items=[{uid:2,chessId:firstItemId()}];
 g.s.summonCards=[{uid:3,type:'silent-drone',name:'医疗无人机',mode:'skill',ownerUid:1,position:null,dir:0}];
 assert.equal(g.handLength(),3);
 assert.equal(g.handFull(),false);
 g.s.summonCards[0].position={x:1,y:1};
 assert.equal(g.handLength(),2,'已放置的召唤物卡不占格');
});

test('整备区满时买不进干员和装备，召唤物卡也收不回整备区',()=>{
 const {g,card,ownerUid}=summonSession();
 g.s.summonCards.find(c=>c.uid===card.uid).position={x:0,y:0};
 g.s.units=[...g.s.units,...fillHand(g,HAND_LIMIT,{ownerUid}).s.units];
 assert.equal(g.handLength(),HAND_LIMIT);
 assert.equal(g.handFull(),true);
 assert.equal(g.perform('withdrawSummon',card.uid),false,'满手不能把召唤物卡收回整备区');
 assert.equal(g.perform('buy',g.s.offers.findIndex(Boolean)),false,'满手不能买干员');
 g.s.units.pop();
 assert.equal(g.perform('withdrawSummon',card.uid),true,'清出空余后可以收回召唤物卡');
 assert.equal(g.handLength(),HAND_LIMIT);
});

test('第三张同名卡仍然可以三合一，但不会因此打开商店',()=>{
 const g=prep(new NativeSession(NATIVE_DATA,{seed:2}));
 const offer=g.s.offers.find(Boolean);
 fillHand(g,HAND_LIMIT,{chessId:offer});
 assert.equal(g.handFull(),true);
 assert.equal(g.perform('buy',g.s.offers.indexOf(offer)),true,'第三张同名卡应当允许购入并三合一');
 assert.equal(g.handLength(),HAND_LIMIT-1,'三合一消耗 3 张、产出 1 张精锐');
 assert.equal(g.s.units.filter(u=>u.chessId===offer).length,8);
 assert.equal(g.perform('buy',g.s.offers.findIndex(Boolean)),false,'合并后仍在 9 张，继续购入同名卡以外的新卡被拒');
});

test('效果发放的卡牌可以临时超出上限，清出空余前禁止购入',()=>{
 const g=prep(new NativeSession(NATIVE_DATA,{seed:3}));
 g.s.itemOffers=[firstItemId()];
 fillHand(g,HAND_LIMIT);
 assert.equal(g.perform('buy',g.s.offers.findIndex(Boolean)),false,'满手不能买入干员');
 assert.equal(g.perform('buyItem',0),false,'满手不能买入装备');
 g.gainItem(firstItemId());
 assert.equal(g.handLength(),HAND_LIMIT+1,'效果发放的装备允许临时超出上限');
 assert.equal(g.s.items.length,1,'超出的装备保留在整备区');
 assert.equal(g.perform('buy',g.s.offers.findIndex(Boolean)),false,'超出上限期间不能购入干员');
 assert.equal(g.perform('buyItem',0),false,'超出上限期间不能购入装备');
 g.s.units.pop();g.s.items=[];
 assert.equal(g.handLength(),HAND_LIMIT-1,'清出空余');
 assert.equal(g.perform('buy',g.s.offers.findIndex(Boolean)),true,'清出空余后恢复购入');
 assert.equal(g.handLength(),HAND_LIMIT);
 assert.equal(g.perform('buyItem',0),false,'刚好满手时仍不能买装备');
 g.s.items=[{uid:999,chessId:firstItemId()}];
 assert.equal(g.perform('buyItem',0),false,'超出上限期间装备不可购入');
});
