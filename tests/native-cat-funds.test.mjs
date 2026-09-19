import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NativeEconomy} from '../dist/native-economy.js';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {INFINITE_FUNDS} from '../dist/protocol.js';
const data=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));

// 海猫模式（mode_cat_all）＝整备资金无限。资金只有「入账／出账／重置」三类写入，
// 全部走 PreparationState 的 setFunds／addFunds，只要 s.cat 为真就收敛回 INFINITE_FUNDS。
// 旧实现只在开局赋一次 MAX_SAFE_INTEGER，beginBattle 的 funds=0 与 nextRound 的
// funds=baseFunding(round) 一执行就退回普通数值——和资金类效果互动一次就不再是无限。
function placeFirst(g){
 for(const u of g.s.units)if(!u.position){for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++)if(g.canDeploy(u.uid,x,y))return g.deploy(u.uid,x,y,0);}
 return false;
}

test('海猫模式：买卖／升级／刷新／出售都不会把无限资金变成普通数值',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:5,cat:true});
 assert.equal(g.s.cat,true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'建对局时就是无限');
 const index=g.s.offers.findIndex(id=>id&&NATIVE_DATA.season.charShopChessDatas[id].chessLevel<=g.s.level);
 assert.ok(index>=0);
 const price=g.price(g.s.offers[index]);
 assert.ok(price>0);
 assert.equal(g.buy(index).ok,true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'买干员之后仍然是无限');
 assert.equal(g.upgrade(),true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'升级之后仍然是无限');
 assert.equal(g.refresh(g.rollOffers()),true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'刷新之后仍然是无限');
 assert.equal(g.sell(g.s.units[0].uid),true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'出售入账之后仍然是无限');
 // 直接走两个写入入口：正负都得是哨兵值
 assert.equal(g.addFunds(-999999),INFINITE_FUNDS);
 assert.equal(g.setFunds(0),INFINITE_FUNDS);
});

test('海猫模式：开战重置与回合重置（baseFunding）都不会打回普通资金',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:6,cat:true});
 const u=g.gain(g.s.offers.find(Boolean));
 assert.equal(placeFirst(g),true,'干员需要落场');
 assert.equal(g.beginBattle(),true);
 assert.equal(g.s.funds,INFINITE_FUNDS,'beginBattle 清零资金是旧的破口');
 assert.equal(g.finishBattle({success:true}),true);
 assert.equal(g.advanceRound(),true);
 assert.equal(g.s.phase,'prep');
 assert.equal(g.s.round,2);
 assert.equal(g.s.funds,INFINITE_FUNDS,'nextRound 重置成当回合基础资金是旧的破口');
 assert.equal(Number.isFinite(g.s.funds),true,'不能越界成 Infinity，否则存档校验会挂');
});

test('海猫模式：利息与金币类策略在无限资金下仍收敛回哨兵值',()=>{
 // band_cannot 的 coin_carry_over 在 prepEnd 结算利息，band_lmlee 的 give_coin_in_round 在 prep 发钱。
 const c=new NativeEconomy(data,'mode_single_normal',{bandId:'band_cannot',cat:true});
 assert.equal(c.s.funds,INFINITE_FUNDS);
 c.startPreparation();
 assert.equal(c.s.funds,INFINITE_FUNDS);
 assert.equal(c.beginBattle(),true);
 assert.equal(c.s.funds,INFINITE_FUNDS);
 assert.equal(Number.isFinite(c.s.carryFunds),true,'利息算出来的 carryFunds 不能是 Infinity');
 c.finishBattle({success:true});
 c.nextRound([]);
 assert.equal(c.s.funds,INFINITE_FUNDS,'把 carryFunds 入账之后仍然是无限');
 const lee=new NativeEconomy(data,'mode_single_normal',{bandId:'band_lmlee',cat:true});
 const rows=data.season.effectBuffInfoDataDict[data.season.bandDataListDict.band_lmlee.effectId];
 const key=rows.findIndex(e=>e.key==='give_coin_in_round');
 assert.ok(key>=0,'band_lmlee 应当有 give_coin_in_round');
 const params=Object.fromEntries(rows[key].blackboard.map(b=>[b.key,b.valueStr??b.value]));
 lee.s.round=Number(params.round);
 lee.s.lastPrepRound=null;
 assert.equal(lee.startPreparation(),true);
 assert.equal(lee.s.funds,INFINITE_FUNDS,'策略直接改资金也保持无限');
});

test('普通模式的资金照常结算（海猫模式不能污染普通流程）',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:5});
 assert.equal(g.s.cat,undefined,'非海猫模式不写 cat 标记');
 const start=g.s.funds;
 assert.ok(start>0&&start<1000);
 const index=g.s.offers.findIndex(id=>id&&NATIVE_DATA.season.charShopChessDatas[id].chessLevel<=g.s.level);
 const price=g.price(g.s.offers[index]);
 assert.equal(g.buy(index).ok,true);
 assert.equal(g.s.funds,start-price);
 const u=g.gain(g.s.offers.find(Boolean));
 assert.equal(placeFirst(g),true);
 assert.equal(g.beginBattle(),true);
 assert.equal(g.s.funds,0,'普通模式开战照旧清零');
 assert.equal(g.finishBattle({success:true}),true);
 assert.equal(g.advanceRound(),true);
 assert.notEqual(g.s.funds,INFINITE_FUNDS,'普通模式回合重置成基础资金，不是无限哨兵值');
 assert.ok(g.s.funds>0&&g.s.funds<1000,'普通模式回合资金是当回合基础资金量级');
});

test('海猫模式的存档读回来后仍然是无限（旧存档里被写坏的数值会被修正）',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:8,cat:true});
 const record=g.snapshot();
 record.s.funds=12; // 模拟旧版本被 beginBattle／nextRound 打回普通数值的存档
 const back=NativeSession.restore(NATIVE_DATA,record);
 assert.ok(back,'存档应当仍然有效');
 assert.equal(back.s.cat,true);
 assert.equal(back.s.funds,INFINITE_FUNDS);
 const plain=new NativeSession(NATIVE_DATA,{seed:8});
 const record2=plain.snapshot();
 record2.s.funds=12;
 const back2=NativeSession.restore(NATIVE_DATA,record2);
 assert.equal(back2.s.funds,12,'普通模式照旧读回原值');
});
