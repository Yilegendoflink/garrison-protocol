import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {STOCK_BY_TIER} from '../dist/protocol.js';

const data=NATIVE_DATA;
const map=data.maps.find(m=>m.weight>0)?.stageId;
const shopRows=Object.values(data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);
const byTier={};
for(const row of shopRows)(byTier[row.chessLevel]??=[]).push(row.chessId);
const session=()=>{const s=new NativeSession(data,{modeId:'mode_single_normal',mapId:map,seed:21});s.s.level=6;s.s.funds=9999;return s;};
const clearPending=s=>{s.s.rewardPending=null;};

test('商店库存按阶级开满，购买扣减、出售回补',()=>{
 const s=session();
 assert.equal(s.s.stock[byTier[1][0]],STOCK_BY_TIER[1]);
 assert.equal(s.s.stock[byTier[4][0]],STOCK_BY_TIER[4]);
 assert.equal(s.s.stock[byTier[5][0]],STOCK_BY_TIER[5]);
 assert.equal(s.s.stock[byTier[6][0]],STOCK_BY_TIER[6]);
 const id=byTier[2][0],before=s.s.stock[id];
 s.s.offers=[id,id,null,null];
 assert.deepEqual(s.buy(0),{ok:true});
 assert.equal(s.s.stock[id],before-1,'购买后库存应减一');
 assert.deepEqual(s.s.units[0].purchases,{[id]:1},'购买记录用于出售回补');
 s.s.offers=[id,null,null,null];
 assert.deepEqual(s.buy(0),{ok:true});
 assert.equal(s.s.stock[id],before-2);
 const unit=s.s.units[0];
 assert.equal(s.sell(unit.uid),true);
 assert.equal(s.s.stock[id],before-1,'出售一件回补一件');
});

test('三合一精锐出售回补合成时买走的所有份数',()=>{
 const s=session();
 const id=byTier[1][1],before=s.s.stock[id];
 for(let i=0;i<3;i++){s.s.offers=[id,null,null,null];assert.deepEqual(s.buy(0),{ok:true});}
 assert.equal(s.s.stock[id],before-3);
 const golden=s.s.units.find(u=>u.chessId!==id&&data.season.charChessDataDict[u.chessId]?.isGolden);
 assert.ok(golden,'三份同名应合成精锐');
 assert.deepEqual(golden.purchases,{[id]:3},'精锐的购买记录应累加三份');
 clearPending(s);
 assert.equal(s.sell(golden.uid),true);
 assert.equal(s.s.stock[id],before,'出售精锐回补三份');
});

test('特殊效果获得的干员不占库存，出售也不回补',()=>{
 const s=session();
 const id=byTier[3][0],before=s.s.stock[id];
 const free=s.gain(id);
 assert.equal(s.s.stock[id],before,'效果获得不扣库存');
 assert.equal(free.purchases,undefined,'效果获得的干员没有购买记录');
 clearPending(s);
 assert.equal(s.sell(free.uid),true);
 assert.equal(s.s.stock[id],before,'出售效果干员不回补库存');
});

test('库存清零后该干员不可再购买',()=>{
 const s=session();
 const id=byTier[6][0];
 s.s.stock[id]=0;
 s.s.offers=[id,null,null,null];
 assert.deepEqual(s.buy(0),{ok:false,code:'NO_STOCK'});
 assert.equal(s.s.stock[id],0,'失败不应继续扣减');
});
