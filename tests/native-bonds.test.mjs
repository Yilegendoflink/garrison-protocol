import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {commitExit,dealDamage,dispatch,tickLogic,applyElementDamage,reviveActor,nearbySpots} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {deployNow,enemy} from './effects-harness.mjs';

const uniqueBond=(id,count)=>[...new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(id)).map(s=>[s.charId,s.chessId])).values()].slice(0,count);
function start(ids,layers={}){
 const g=new NativeSession(NATIVE_DATA,{seed:1});g.s.funds=9999;g.s.capacity=16;for(const id of ids)g.gain(id);g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const [id,n] of Object.entries(layers))g.s.bondLayers[id]=n;
 for(const u of g.s.units){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);}assert.ok(placed,'no tile for '+u.chessId);}
 assert.equal(g.perform('start'),true,g.lastError||'start failed');const b=g.battle;b.s.queue=[];b.s.limit=1e9;deployNow(b);return {g,b};
}

test('大盟约炎召唤炎佑并按6人谢拉格建立寒风周期',()=>{
 const {b}=start(uniqueBond('yanShip',6),{yanShip:0});assert.equal(b.s.summons.filter(s=>s.type==='yan-guardian').length,1);assert.ok(b.s.summons[0].atk>0);
 const k=start(uniqueBond('kjeragShip',6),{kjeragShip:0}).b;assert.ok(k.s.logicEffects.some(x=>x.talentOrSkillId==='bond-kjerag-storm'&&x.interval===25));
});

test('炎佑不收集调和虚拟炎属性并在9层召唤双炎佑',()=>{
 const yan=uniqueBond('yanShip',6),mani=uniqueBond('maniShip',1).find(id=>!yan.includes(id));assert.ok(mani);
 const {b}=start([...yan,mani]),baseline=start(yan).b;const guards=b.s.summons.filter(s=>s.type==='yan-guardian');assert.equal(guards.length,1);
 const savedRows=b.rows,savedDeploy=b.s.units.map(u=>u.deployed);b.rows=baseline.rows;b.s.units.forEach(u=>u.deployed=false);const expected=b.s.units.filter(u=>b.economy.ownBonds(u.source).includes('yanShip')).reduce((n,u)=>n+b.stats(u).atk,0)*.3;b.rows=savedRows;b.s.units.forEach((u,i)=>u.deployed=savedDeploy[i]);assert.ok(Math.abs(guards[0].atk-expected)<1e-6);
 const nine=start(uniqueBond('yanShip',9)).b,nineGuards=nine.s.summons.filter(s=>s.type==='yan-guardian');assert.equal(nineGuards.length,2);assert.ok(nineGuards.every(g=>g.atk>guards[0].atk));
});

test('炎佑模式乙持续施法、元素光环、元素免疫和沉默打断',()=>{
 const {b}=start(uniqueBond('yanShip',6)),g=b.s.summons.find(s=>s.type==='yan-guardian');
 const target=enemy(b,{x:g.x+2,y:g.y,hp:100000,threat:10,def:0,res:0}),splash=enemy(b,{x:g.x+2,y:g.y+1,hp:100000,threat:1,def:0,res:0}),aura=enemy(b,{x:g.x+1,y:g.y,hp:100000,threat:0,def:0,res:0}),outside=enemy(b,{x:g.x+2,y:g.y+2,hp:100000,threat:0,def:0,res:0});
 g.attackCooldown=999;tickLogic(b,0);assert.equal(g.yanSkillActive,true);const targetHp=target.hp,splashHp=splash.hp,outsideHp=outside.hp; b.s.time=1;tickLogic(b,1);
 assert.ok(target.hp<targetHp&&splash.hp<splashHp&&outside.hp===outsideHp);assert.equal(aura.yanElementDamageTakenBonus,.2);assert.equal(outside.yanElementDamageTakenBonus,0);
 const elemental=applyElementDamage(b,{source:g,target:aura,amount:100,type:'burn'});assert.equal(elemental.added,120);assert.equal(applyElementDamage(b,{source:target,target:g,amount:100,type:'burn'}).added,0);const guardianHp=g.hp;dealDamage(b,{source:target,target:g,amount:100,type:'true'});assert.equal(Math.round(guardianHp-g.hp),10);
 applyStatus(g,'silence',1,{source:target.uid});b.s.time+=1/30;tickLogic(b,1/30);assert.equal(g.yanSkillActive,false);
});

test('炎佑「祛恶之焰」目标死亡时立刻结束，不换目标继续施法',()=>{
 const {b}=start(uniqueBond('yanShip',6)),g=b.s.summons.find(s=>s.type==='yan-guardian');
 const target=enemy(b,{x:g.x+2,y:g.y,hp:100000,threat:10,def:0,res:0}),other=enemy(b,{x:g.x+2,y:g.y+1,hp:100000,threat:1,def:0,res:0});
 g.attackCooldown=999;tickLogic(b,0);
 assert.equal(g.yanSkillActive,true,'应先开技');
 assert.equal(g.yanSkillTargetUid,target.uid,'锁定仇恨最高的目标');
 // 目标被击倒 → 下一次结算立刻结束，不再锁定旁边的敌人
 target.hp=0;target.hidden=true;
 b.s.time+=1/30;tickLogic(b,1/30);
 assert.equal(g.yanSkillActive,false,'目标死亡后技能立刻结束');
 assert.equal(g.yanSkillTargetUid,null,'不再锁定新目标');
 assert.ok((b.s.events||[]).some(e=>e.type==='skill-end'&&e.uid===g.uid&&e.reason==='target-lost'),'结束原因应为 target-lost');
 const otherHp=other.hp;
 for(let i=0;i<90;i++){b.s.time+=1/30;tickLogic(b,1/30);}
 assert.equal(other.hp,otherHp,'结束后不得再对周围敌人造成技能伤害');
});

test('萨尔贡技能启动给全体萨尔贡叠加独立持续时间攻速',()=>{
 const {b}=start(uniqueBond('sargonShip',3));const u=b.s.units[0],before=b.stats(u).attackSpeed;u.sp=b.spCost(u);b.activate(u);assert.equal(b.s.units.filter(v=>v.sargonBuffs?.length===1).length,3);assert.equal(b.stats(u).attackSpeed,before+12);
});

test('拉特兰盟约增加弹药并在6人消耗弹药后提高攻击',()=>{
 const {b}=start(uniqueBond('lateranoShip',6),{lateranoShip:20});const u=b.s.units.find(v=>b.profile(v).skill?.durationType==='AMMO');assert.ok(u);u.sp=b.spCost(u);const base=u.profile?.skill; b.activate(u);assert.ok(u.ammo>0);const atk=b.stats(u).atk;dispatch(b,'ammo',{source:u,target:u,used:1});assert.ok(b.stats(u).atk>atk);assert.ok(u.ammo>=0);
});

test('迅捷技能结束按概率回复技力，40层额外回复全体技力',()=>{
 const swifts=uniqueBond('swiftShip',2),{b}=start(swifts,{swiftShip:40}),u=b.s.units[0];u.skillCount=1;u.skillLeft=0;u.ammo=0;u.sp=0;b.economy.random=()=>0;dispatch(b,'skill-end',{target:u});assert.ok(u.sp>=12);
});

test('坚守分摊非坚守伤害并对伤害来源反击施加脆弱',()=>{
 const ids=[...uniqueBond('steadShip',3),...uniqueBond('swiftShip',1)],{b}=start(ids);const target=b.s.units[3],guard=b.s.units[0],e=enemy(b,{x:target.x,y:target.y,hp:10000,def:0,res:0});const hp=target.hp,hg=guard.hp;dealDamage(b,{source:e,target,amount:100,type:'true'});assert.equal(Math.round(hp-target.hp),60);assert.ok(hg-guard.hp>0);const eh=e.hp;dealDamage(b,{source:e,target:guard,amount:10,type:'true'});assert.ok(eh-e.hp>800);assert.equal(e.fragile,1.4);b.s.time=1;tickLogic(b,1);assert.equal(e.fragile,1.4);
});

test('阿戈尔战斗开始吞噬身前干员并支持前三名首次复活',()=>{
 const {b}=start(uniqueBond('egirShip',5),{egirShip:0});assert.ok(b.s.units.some(u=>u.egirConsumedUid));b.s.bondEgirReviveCount=0;for(const u of b.s.units)u.egirRevived=false;const u=b.s.units.at(-1),e=enemy(b,{x:u.x,y:u.y});dealDamage(b,{source:e,target:u,amount:1e9,type:'true'});assert.ok(u.hp>0&&u.deployed&&u.egirRevived);
});

test('阿戈尔复活判定不把敌方目标传入干员盟约读取',()=>{
 const {b}=start(uniqueBond('egirShip',5),{egirShip:0}),source=b.s.units[0],target=enemy(b,{x:source.x,y:source.y,hp:1,def:0,res:0});
 assert.doesNotThrow(()=>dealDamage(b,{source,target,amount:1e9,type:'true'}));assert.equal(target.hp,0);
});

test('叙拉古部署隐匿、卡西米尔阻挡周期伤害和突袭闲置再部署',()=>{
 const s=start(uniqueBond('siracusaShip',6),{siracusaShip:0}).b;assert.ok(s.s.units.every(u=>u.siracusaInvisibleUntil>s.s.time));
 // 盟约隐匿必须真的挡住敌人：远程敌人不选隐匿中的叙拉古干员，隐匿窗口结束后恢复可选
 const si=s.s.units[0];
 for(const u of s.s.units.slice(1)){u.x=-20-u.uid;u.y=-20;}   // 其余干员挪开，避免挡住敌人干扰观察
 const foe=enemy(s,{x:si.x+2,y:si.y,hp:1e6,ranged:true,range:9,interval:1,canAttack:true,attackCooldown:0});
 s.step();
 assert.equal(si.invisible,true,'部署后带隐匿状态');
 assert.notEqual(foe.action?.target,si.uid,'隐匿中的叙拉古干员不能被远程敌人选为目标');
 si.statuses=si.statuses.filter(x=>x.kind!=='invisible');si.invisible=false;s.siracusaInvisibleUntil=0;
 let sawTarget=false;for(let i=0;i<40;i++){s.step();if(foe.action?.target===si.uid)sawTarget=true;}
 assert.ok(sawTarget,'隐匿结束后恢复可选');
 const k=start(uniqueBond('kazimierzShip',6)).b,u=k.s.units[0],e=enemy(k,{x:u.x,y:u.y,hp:10000,block:u.uid,def:0,res:0});u.kazimierzNextAt=0;k.s.time=2;tickLogic(k,0);assert.ok(e.hp<10000&&e.statuses.some(x=>x.kind==='stun'));
 const r=start(uniqueBond('raidShip',2),{raidShip:50}).b,ru=r.s.units[0];ru.raidIdleSince=0;ru.sp=0;r.s.time=11;enemy(r,{x:ru.x+5,y:ru.y,hp:10000});r.tickBondIdle(ru,0);assert.ok(ru.raidBuffUntil>11);
});

test('突袭再部署不与干员／占格子的召唤物重合，四向被占就往外找',()=>{
 const {b}=start(uniqueBond('raidShip',2),{raidShip:50}),ru=b.s.units[0],mate=b.s.units[1];
 ru.raidIdleSince=0;ru.sp=0;b.s.time=11;
 const e=enemy(b,{x:ru.x+5,y:ru.y,hp:10000});
 mate.x=e.x+1;mate.y=e.y;   // 右侧邻格站着自己的干员
 b.s.summons.push({uid:b.s.nextId++,id:'probe-summon',kind:'summon',allied:true,canBlock:true,occupiesTile:true,x:e.x-1,y:e.y,hp:100,maxHp:100,deployed:true});
 b.tickBondIdle(ru,0);
 assert.ok(ru.raidBuffUntil>11,'邻格被占也要找得到落点，而不是不落');
 assert.ok(!(ru.x===e.x+1&&ru.y===e.y),'不能压在别的干员身上');
 assert.ok(!(ru.x===e.x-1&&ru.y===e.y),'不能压在占格子的召唤物上');
 assert.ok(Math.max(Math.abs(ru.x-e.x),Math.abs(ru.y-e.y))<=3,`落点要在敌人周围，实际 ${ru.x},${ru.y}`);
});
test('突袭闲置位移在真实步进里满 10 秒才触发，并走公共位移链路',()=>{
 const {b}=start(uniqueBond('raidShip',2),{raidShip:50});
 const ru=b.s.units[0],from={x:ru.x,y:ru.y};ru.sp=0;
 const e=enemy(b,{x:ru.x+6,y:ru.y,hp:1e6});
 for(let i=0;i<Math.round(9.5*30);i++)b.step();
 assert.deepEqual({x:ru.x,y:ru.y},from,'不满 10 秒不位移');
 for(let i=0;i<Math.round(1*30);i++)b.step();
 assert.notDeepEqual({x:ru.x,y:ru.y},from,'闲置满 10 秒后要位移走');
 assert.ok(!(ru.x===e.x&&ru.y===e.y),'落点不能和敌人同格');
 assert.ok(ru.raidBuffUntil>=b.s.time,`位移后要拿到攻防加成窗口，实际 ${ru.raidBuffUntil}`);
 assert.ok(b.s.logicLog.some(x=>x.type==='move'&&x.uid===ru.uid&&x.mode==='raid-redeploy'),'位移走公共位移链路');
});
test('突袭敌人周围全是占位时一路往外找落点，不压在任何人身上',()=>{
 const {b}=start(uniqueBond('raidShip',2),{raidShip:50});
 const ru=b.s.units[0],from={x:ru.x,y:ru.y};ru.sp=0;
 const e=enemy(b,{x:ru.x+6,y:ru.y,hp:1e6});
 // 用占格子的召唤物把敌人 3 圈内所有可部署格填满：落点必须找到更外面去
 const blocked=[];
 for(const spot of nearbySpots(e,{maxRadius:3})){
  const tile=b.map.grid[spot.y]?.[spot.x];
  if(!tile||tile.buildableType==='NONE'||tile.obstacle)continue;
  if(spot.x===ru.x&&spot.y===ru.y)continue;
  blocked.push(spot.x+','+spot.y);
  b.s.summons.push({uid:b.s.nextId++,id:'probe-summon',kind:'summon',allied:true,canBlock:true,occupiesTile:true,x:spot.x,y:spot.y,hp:100,maxHp:100,deployed:true});
 }
 assert.ok(blocked.length>0,'测试需要先把近处填满');
 for(let i=0;i<12*30;i++)b.step();
 const landed=ru.x+','+ru.y;
 assert.notDeepEqual({x:ru.x,y:ru.y},from,'近处被占满也要找得到落点，而不是不位移');
 assert.ok(!blocked.includes(landed)&&!(ru.x===e.x&&ru.y===e.y),`落点不能在占位/敌人身上，实际 ${landed}`);
 assert.ok(Math.max(Math.abs(ru.x-e.x),Math.abs(ru.y-e.y))>3,`近处满了就该到更外面，实际 ${landed}`);
});
test('卡西米尔部署卫戍识别 onstart，并在重新部署时重复叠层且遵守每场上限',()=>{
 const forbidden=new Set(['char_237_gravel','char_423_blemsh','char_430_fartth','char_1014_nearl2','char_4116_blkkgt']);
 const pool=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes('kazimierzShip')&&!forbidden.has(s.charId));
 const gravel=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId==='char_237_gravel'&&!s.isHidden).chessId;
 const blemsh=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId==='char_423_blemsh'&&!s.isHidden).chessId;
 const {g:gravelGame,b:gravelBattle}=start([gravel,...pool.slice(0,5).map(s=>s.chessId)]);const gravelUnit=gravelBattle.s.units.find(u=>u.id==='char_237_gravel'),beforeGravel=gravelGame.s.bondLayers.kazimierzShip||0;gravelBattle.s.cost=999;commitExit(gravelBattle,{target:gravelUnit,reason:'knockdown'});gravelUnit.down=0;gravelBattle.deploy(gravelUnit,{reentry:true});assert.equal(gravelGame.s.bondLayers.kazimierzShip,beforeGravel+1);const beforeRevive=gravelGame.s.bondLayers.kazimierzShip;commitExit(gravelBattle,{target:gravelUnit,reason:'knockdown'});assert.equal(reviveActor(gravelBattle,gravelUnit,{hpRatio:1}),true);assert.equal(gravelGame.s.bondLayers.kazimierzShip,beforeRevive+1);
 const {g:blemshGame,b:blemshBattle}=start([blemsh,...pool.slice(0,5).map(s=>s.chessId)]);const blemshUnit=blemshBattle.s.units.find(u=>u.id==='char_423_blemsh'),initial=blemshGame.s.bondLayers.kazimierzShip||0;blemshBattle.s.cost=999;for(let i=0;i<3;i++){commitExit(blemshBattle,{target:blemshUnit,reason:'knockdown'});blemshUnit.down=0;blemshBattle.deploy(blemshUnit,{reentry:true});}assert.equal(blemshGame.s.bondLayers.kazimierzShip,initial+8);
});

test('卡西米尔战斗开始的动态卫戍会在目标重新部署时生效',()=>{
 const forbidden=new Set(['char_237_gravel','char_423_blemsh','char_430_fartth','char_1014_nearl2','char_4116_blkkgt']);
 const pool=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes('kazimierzShip')&&!forbidden.has(s.charId));
 const fartth=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId==='char_430_fartth'&&!s.isHidden).chessId;
 const {g,b}=start([fartth,...pool.slice(0,5).map(s=>s.chessId)]);const target=b.s.units.find(u=>u.extraGarrisonIds?.some(id=>id.startsWith('garrison_108_')));assert.ok(target);const before=g.s.bondLayers.kazimierzShip||0;b.s.cost=999;commitExit(b,{target,reason:'knockdown'});target.down=0;b.deploy(target,{reentry:true});assert.ok((g.s.bondLayers.kazimierzShip||0)>before);
});

test('维多利亚25层发放随机维式重锤',()=>{
 const {g}=start(uniqueBond('victoriaShip',3));g.s.bondLayers.victoriaShip=25;const before=JSON.stringify(g.s.items);g.settleBondRewards();assert.notEqual(JSON.stringify(g.s.items),before);assert.equal(g.s.claimedBondRewards['victoriaShip:1'],1);
});

test('不屈三人击倒时给场上干员回复5技力',()=>{
 const ids=[...uniqueBond('indomShip',3),uniqueBond('swiftShip',1)[0]],{b}=start(ids);const target=b.s.units[0],ally=b.s.units[3],before=ally.sp;commitExit(b,{target,reason:'knockdown'});assert.ok(ally.sp>before);
});
