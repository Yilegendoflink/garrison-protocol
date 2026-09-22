import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {activeBonds} from '../dist/protocol.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 装备的 `giveBondId` 是**它自己的盟约归属**（商店与具名池按它取货），不是给携带者的盟约。
// 曾经的实现把每件装备的 giveBondId 一律叠进 u.bondIds，于是「给谁都装一件谢拉格不融冰」
// 就能凑出谢拉格层数、触发 6 层寒风，也会点亮「若携带者为【X】盟约干员」的装备效果。
// 只有 canGiveBond 的装备（变形同构体）才给携带者盟约，且给的是另一件携带装备的盟约。
const ICE='chess_item_5_02_e_a';          // 谢拉格不融冰（giveBondId=kjeragShip）
const SHAPE='chess_item_6_09_e_a';        // 变形同构体（canGiveBond=true，自己 giveBondId=null）
const SALT='chess_item_4_10_e_a';         // 浓缩嗅盐（giveBondId=null，没有盟约归属）
const YAK='chess_char_1_02_a';            // 角峰（kjeragShip）
const GHOST='chess_char_2_07_a';          // 幽灵鲨（egirShip，不是谢拉格）

function session(seed=5){
 const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed,bandId:'band_bldsk'});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 return g;
}
function equip(g,uid,itemId){
 const item=g.gainItem(itemId);
 assert.equal(g.equip(item.uid,uid),true,`装备 ${itemId} 应当成功`);
 return item;
}
function place(g,u){
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
  if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;
  if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 }
 assert.ok(placed,'干员需要落场');
}

test('装备的盟约归属不会变成携带者的盟约（谢拉格不融冰不再算谢拉格）',()=>{
 const g=session(),ghost=g.gain(GHOST);
 assert.deepEqual(g.ownBonds(ghost),data.season.charChessDataDict[GHOST].bondIds);
 equip(g,ghost.uid,ICE);
 assert.deepEqual(g.ownBonds(ghost),data.season.charChessDataDict[GHOST].bondIds,'装上不融冰也不该多出 kjeragShip');
 assert.equal(g.ownBonds(ghost).includes('kjeragShip'),false);
 // 盟约计数只认真干员
 place(g,ghost);
 assert.equal(g.bonds().kjeragShip.count,0,'装备不参与盟约计数');
});

test('盟约激活不靠装备凑数：装备不参与层数，真干员到位才激活',()=>{
 const g=session();
 const threshold=Number(data.season.bondInfoDict.kjeragShip.activeParamList[0]);
 assert.ok(threshold>=2,'谢拉格的激活阈值应当至少 2，这条用例才有判别力');
 // 计数按 charId 去重，所以样本要取不同干员
 const seen=new Set(),kjerag=[];
 for(const s of Object.values(data.season.charShopChessDatas)){
  if(!s.charId||s.isHidden||seen.has(s.charId))continue;
  if(!(data.season.charChessDataDict[s.chessId]?.bondIds||[]).includes('kjeragShip'))continue;
  seen.add(s.charId);kjerag.push(s.chessId);
 }
 assert.ok(kjerag.length>=threshold,'样本里应当有至少 '+threshold+' 名不同谢拉格干员');
 for(const id of kjerag.slice(0,threshold-1))place(g,g.gain(id));
 const foreign=g.gain(GHOST);place(g,foreign);equip(g,foreign.uid,ICE);
 const rows=g.bonds();
 assert.equal(rows.kjeragShip.count,threshold-1,'带不融冰的幽灵鲨不算谢拉格层数');
 assert.equal(rows.kjeragShip.active,false,'所以盟约不该被装备凑到激活');
 place(g,g.gain(kjerag[threshold-1]));
 assert.equal(g.bonds().kjeragShip.count,threshold,'真干员到位才计数');
 assert.equal(g.bonds().kjeragShip.active,true,'到达阈值才激活');
});

test('变形同构体才是给携带者盟约的那件，且给的是另一件装备的盟约',()=>{
 const g=session(),ghost=g.gain(GHOST);
 equip(g,ghost.uid,ICE);
 assert.equal(g.ownBonds(ghost).includes('kjeragShip'),false,'只有不融冰时没有额外盟约');
 equip(g,ghost.uid,SHAPE);
 assert.ok(g.ownBonds(ghost).includes('kjeragShip'),'带上变形同构体后才获得不融冰对应的【谢拉格】');
 assert.equal(g.ownBonds(ghost).includes('egirShip'),true,'干员自身盟约仍在');
 // 换掉不融冰 → 变形同构体借来的盟约也要跟着走
 g.destroyEquipment(ghost.uid,0);
 assert.equal(g.ownBonds(ghost).includes('kjeragShip'),false,'另一件装备没了，借来的盟约随之消失');
});

test('变形同构体配上没有盟约归属的装备不会凭空给盟约',()=>{
 const g=session(),ghost=g.gain(GHOST);
 equip(g,ghost.uid,SALT);equip(g,ghost.uid,SHAPE);
 assert.deepEqual(g.ownBonds(ghost),data.season.charChessDataDict[GHOST].bondIds,'浓缩嗅盐没有 giveBondId，借不到东西');
 // 单独一件变形同构体同样不给
 const solo=session(),other=solo.gain(GHOST);
 equip(solo,other.uid,SHAPE);
 assert.deepEqual(solo.ownBonds(other),data.season.charChessDataDict[GHOST].bondIds);
});

test('旧存档里被装备叠出来的盟约在读档时按新口径重算（自然愈合）',()=>{
 const g=session(),ghost=g.gain(GHOST);
 equip(g,ghost.uid,ICE);
 const record=g.snapshot();
 record.s.units.find(u=>u.uid===ghost.uid).bondIds=[...data.season.charChessDataDict[GHOST].bondIds,'kjeragShip'];
 const back=NativeSession.restore(data,JSON.parse(JSON.stringify(record)));
 assert.ok(back,'存档应当仍然有效');
 assert.deepEqual(back.ownBonds(back.s.units.find(u=>u.uid===ghost.uid)),data.season.charChessDataDict[GHOST].bondIds,'误加的 kjeragShip 应当被清掉');
 // 变形同构体那条合法路径不受愈合影响
 const shape=session(),carrier=shape.gain(GHOST);
 equip(shape,carrier.uid,ICE);equip(shape,carrier.uid,SHAPE);
 const kept=NativeSession.restore(data,JSON.parse(JSON.stringify(shape.snapshot())));
 assert.ok(kept.ownBonds(kept.s.units.find(u=>u.uid===carrier.uid)).includes('kjeragShip'),'变形同构体借来的盟约要保留');
});

test('activeBonds 直接读 u.bondIds 时也不再被装备污染',()=>{
 const g=session(),ghost=g.gain(GHOST);
 equip(g,ghost.uid,ICE);
 const row=activeBonds(data,[{uid:ghost.uid,chessId:ghost.chessId,charId:ghost.charId,bondIds:g.ownBonds(ghost),position:{x:0,y:0}}]);
 assert.equal(row.kjeragShip.count,0);
});
