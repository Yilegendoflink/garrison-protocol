import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';

// 拟态物质（chess_item_5_05_e_a／精英 _b，效果 key use_equip_reward_char_chess，黑板为空）：
// 描述写「装备时销毁，若已拥有至少2名该初始干员，则再获得1名该初始干员；否则随机获得1名同盟约初始干员」，
// 规则只在文本里，所以要按描述实现并钉住。
const ITEM='chess_item_5_05_e_a',ITEM_ELITE='chess_item_5_05_e_b';
const info=NATIVE_DATA.season.effectInfoDataDict;

function session(){
 const g=new NativeSession(NATIVE_DATA,{seed:7,bandId:'band_bldsk'});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 return g;
}
const initialOf=(g,chessId)=>g.data.season.chessNormalIdLookupDict[chessId]||chessId;
const lineOf=(g,initial)=>g.s.units.filter(u=>initialOf(g,u.chessId)===initial);

test('拟态物质的描述来自原表，两个阶的效果 key 相同',()=>{
 const desc=(info['eff_acarm069']?.effectDesc||'').replace(/<[^>]+>/g,'');
 assert.match(desc,/装备时销毁/);
 assert.match(desc,/若已拥有至少2名该初始干员，则再获得1名该初始干员/);
 assert.match(desc,/否则随机获得1名同盟约初始干员/);
 assert.equal((info['eff_acgarm069']?.effectDesc||''),info['eff_acarm069'].effectDesc,'两个阶描述一致');
 for(const id of [ITEM,ITEM_ELITE]){
  const def=NATIVE_DATA.season.trapChessDataDict[id];
  assert.equal(def.itemType,'EQUIP');
  assert.deepEqual((NATIVE_DATA.season.effectBuffInfoDataDict[def.effectId]||[]).map(e=>e.key),['use_equip_reward_char_chess'],`${id} 的效果 key`);
  assert.equal((NATIVE_DATA.season.effectBuffInfoDataDict[def.effectId]||[])[0].blackboard.length,0,'黑板为空：规则只在描述里');
 }
});

test('已拥有至少2名该初始干员：再给1名该初始干员，装备销毁',()=>{
 const g=session();
 const chessId=Object.values(NATIVE_DATA.profiles).find(p=>p?.charId&&!p.isHidden).chessId;
 const initial=initialOf(g,chessId);
 g.gain(chessId);g.gain(chessId);g.gain(chessId); // 三合一 → 精锐
 g.s.rewardPending=null;g.s.rewardQueue=[];
 g.gain(chessId); // 再补一张普通卡：该初始干员共 2 名（精锐 + 普通）
 assert.equal(lineOf(g,initial).length,2,'开装备前该初始干员有 2 名');
 const carrier=g.s.units.find(u=>initialOf(g,u.chessId)===initial);
 const before=g.s.units.length;
 const item=g.gainItem(ITEM);
 assert.equal(g.equip(item.uid,carrier.uid),true,'装备应当成功');
 assert.equal(g.s.items.some(i=>i.uid===item.uid),false,'装备时销毁：不留在手牌');
 assert.equal(g.s.units.length,before+1,'再获得 1 名该初始干员');
 assert.equal(lineOf(g,initial).length,3);
 assert.equal(g.s.units.some(u=>u.chessId===initial),true,'给的必须是该初始（普通）形态');
});

test('不足2名时随机获得1名同盟约初始干员，装备同样销毁',()=>{
 const g=session();
 const p=Object.values(NATIVE_DATA.profiles).find(x=>x?.charId&&!x.isHidden&&(x.bonds||[]).length);
 const bond=p.bonds[0];
 const carrier=g.gain(p.chessId);
 const initial=initialOf(g,carrier.chessId);
 assert.equal(lineOf(g,initial).length,1,'只带一张时不足 2 名');
 const item=g.gainItem(ITEM_ELITE); // 精英阶走同一个 key
 const before=new Set(g.s.units.map(u=>u.uid));
 assert.equal(g.equip(item.uid,carrier.uid),true);
 assert.equal(g.s.items.some(i=>i.uid===item.uid),false,'装备时销毁');
 const added=g.s.units.filter(u=>!before.has(u.uid));
 assert.equal(added.length,1,'获得 1 名干员');
 const got=added[0];
 assert.notEqual(initialOf(g,got.chessId),initial,'不足 2 名时给的不是同一个初始干员');
 const gotBonds=g.data.season.charChessDataDict[got.chessId]?.bondIds||[];
 const carrierBonds=g.ownBonds(carrier);
 assert.ok(gotBonds.some(b=>carrierBonds.includes(b)),`抽到的干员应当与携带者同盟约（携带者 ${carrierBonds.join(',')}；抽到 ${gotBonds.join(',')}）`);
 assert.ok(NATIVE_DATA.season.charShopChessDatas[got.chessId].chessLevel<=g.s.level,'不超过当前调度中心等级');
});
