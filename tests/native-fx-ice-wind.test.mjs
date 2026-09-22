import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {deployNow,enemy} from './effects-harness.mjs';
import {drawIceWind,drawZones} from '../dist/native-fx.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

const uniqueBond=(id,count)=>[...new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(id)).map(s=>[s.charId,s.chessId])).values()].slice(0,count);
function kjeragBattle(count=6){
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:1});g.s.funds=9999;g.s.capacity=16;
 for(const id of uniqueBond('kjeragShip',count))g.gain(id);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of g.s.units){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);}assert.ok(placed,'no tile for '+u.chessId);}
 assert.equal(g.perform('start'),true,g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;deployNow(b);
 // 场上必须留一个无害目标，否则 "队列空且无敌人" 会让战斗在第 1 帧判负结束（battle:367）
 enemy(b,{hp:1e12,x:-8,y:-8,trainingDummy:true,hidden:true,untargetable:true,invulnerable:true});
 return b;
}
const runTo=(b,seconds)=>{let guard=0;while(b.s.time<seconds-1e-9&&!b.s.finished){if(++guard>200000)throw Error('runTo 未收敛');b.step();}};
const iceWinds=b=>(b.s.events||[]).filter(e=>e.type==='ice-wind');

test('6人谢拉格的寒风在每25秒结算时发出一条 ice-wind 事件',()=>{
 const b=kjeragBattle(6);
 const storm=b.s.logicEffects.find(fx=>fx.talentOrSkillId==='bond-kjerag-storm');
 assert.ok(storm,'应存在寒风周期效果');
 assert.equal(storm.interval,25);
 assert.equal(iceWinds(b).length,0,'开局不应立刻起风');

 runTo(b,24.5);
 assert.equal(iceWinds(b).length,0,'25 秒前不得起风');
 runTo(b,25.5);
 assert.equal(b.s.finished,false,'基准场景不应提前结束');
 const first=iceWinds(b);
 assert.equal(first.length,1,'25 秒结算时正好一条');
 assert.equal(first[0].t,25);
 assert.equal(first[0].uid,storm.sourceUid,'事件需带源干员，供特效定位');
 assert.equal(first[0].effectId,storm.id,'事件需带效果 id，供读取 period 等参数');
 assert.equal(typeof first[0].id,'number');
 // 周期继续推进：下一次结算应排在 50 秒，而不是不再触发
 assert.equal(b.s.logicEffects.find(fx=>fx.id===storm.id).nextAt,50);

 // 冰风每轮都会重新施加寒冷（说明周期确实在结算，而不只是排了队）
 runTo(b,50.5);
 assert.equal(iceWinds(b).length,1,'25–50 秒之间不得重复起风');
 assert.equal(iceWinds(b)[0].t,50,'事件缓冲只保留最新一条，此处应为第二轮');
 assert.equal(b.s.logicEffects.find(fx=>fx.id===storm.id).nextAt,75);
 assert.ok(b.s.enemies.some(e=>(e.statuses||[]).some(s=>s.kind==='cold')),'每轮都应给敌人施加寒冷');
});

test('不足6人谢拉格时不生成寒风，也就没有 ice-wind',()=>{
 const b=kjeragBattle(5);
 assert.equal(b.s.logicEffects.some(fx=>fx.talentOrSkillId==='bond-kjerag-storm'),false);
 runTo(b,26);
 assert.equal(iceWinds(b).length,0);
});

function host(){
 const ops=[],state={saves:0,restores:0};
 const c={globalCompositeOperation:'source-over',lineCap:'butt',strokeStyle:'',fillStyle:'',lineWidth:1,
  save(){state.saves++;},restore(){state.restores++;},
  createLinearGradient(...a){const stops=[];ops.push({op:'gradient',args:a,stops});return {addColorStop:(o,col)=>stops.push([o,col])};},
  fillRect(...a){ops.push({op:'fillRect',args:a,style:this.fillStyle,comp:this.globalCompositeOperation});},
  beginPath(){ops.push({op:'beginPath'});},moveTo(){},lineTo(){},stroke(){ops.push({op:'stroke',style:this.strokeStyle,width:this.lineWidth});},
  arc(){},ellipse(){}};
 return {c,ops,state};
}
const Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};

test('冰风绘制：全屏提亮、随 age 渐入渐出、冷雾为白色系',()=>{
 const b=kjeragBattle(6);runTo(b,25.2);
 const {c,ops,state}=host();
 assert.equal(drawIceWind(c,Z,b),true);
 assert.equal(state.saves,1);assert.equal(state.restores,1,'必须成对 save/restore');
 const fill=ops.find(o=>o.op==='fillRect');
 assert.deepEqual(fill.args,[0,0,800,520],'冷雾覆盖整块画布');
 assert.equal(fill.comp,'lighter','只提亮，不压暗界面');
 const grad=ops.find(o=>o.op==='gradient');
 assert.ok(grad.stops.every(([,col])=>/^rgba\((19[0-9]|2[0-5][0-9]),\d+,\d+,/.test(col)),'更白的冰蓝：红通道接近 200~255');
 const alpha=Number(grad.stops[0][1].match(/,([\d.]+)\)$/)[1]);
 assert.ok(alpha>0&&alpha<.2,'峰值透明度必须很低，避免遮盖界面');
 assert.equal(ops.filter(o=>o.op==='stroke').length,8,'常规为 8 道风痕');
});

test('冰风绘制：窗口外不画、reduceFx 减量、不写入战斗状态',()=>{
 const b=kjeragBattle(6);
 const before=JSON.stringify(b.s);
 const dry=host();
 assert.equal(drawIceWind(dry.c,Z,b),false,'没有事件时不应绘制');
 assert.equal(dry.ops.length,0);
 assert.equal(JSON.stringify(b.s),before,'绘制不得改动战斗状态');

 runTo(b,25.2);
 const reduced=host();
 assert.equal(drawIceWind(reduced.c,Z,b,{reduceFx:true}),true);
 assert.equal(reduced.ops.filter(o=>o.op==='stroke').length,3,'减少动效时风痕降到 3 道');
 const grad=reduced.ops.find(o=>o.op==='gradient');
 const alpha=Number(grad.stops[0][1].match(/,([\d.]+)\)$/)[1]);
 assert.ok(alpha>0,'减少动效仍保留可见提示');

 // 1 秒视觉窗口之外自然消失
 runTo(b,26.4);
 const gone=host();
 assert.equal(drawIceWind(gone.c,Z,b),false);
 assert.equal(gone.ops.length,0);
});

test('冰风窗口以 1 秒为界，中途最亮',()=>{
 const b=kjeragBattle(6);
 const alphaAt=()=>{const {c,ops}=host();if(!drawIceWind(c,Z,b))return 0;const g=ops.find(o=>o.op==='gradient');const m=g.stops[0][1].match(/,([\d.]+)\)$/);if(!m)throw Error('unparsable stop colour: '+JSON.stringify(g.stops));return Number(m[1]);};
 const stepTo=t=>{while(b.s.time<t-1e-9&&!b.s.finished)b.step();};
 stepTo(24.9);
 assert.equal(alphaAt(),0,'25 秒前不应有冰风');
 const samples=[];
 for(const t of [25.03,25.25,25.5,25.75,25.95]){stepTo(t);samples.push(alphaAt());}
 const [in1,in2,mid,out2,out1]=samples;
 assert.ok(samples.every(v=>v>0),'窗口内应有可见强度 '+JSON.stringify(samples));
 assert.ok(mid>=in2&&in2>=in1,'渐入：越接近中段越亮');
 assert.ok(mid>=out2&&out2>=out1,'渐出：越接近结尾越淡');
 stepTo(26.1);
 assert.equal(alphaAt(),0,'1 秒之后必须完全消失');
});

test('6人谢拉格不留常驻区域底色，只有起风那 1 秒有全屏特效',()=>{
 const b=kjeragBattle(6);
 assert.ok(b.s.logicEffects.some(fx=>fx.talentOrSkillId==='bond-kjerag-storm'),'寒风区域应当存在（判定仍在跑）');
 const idle=host();
 assert.equal(drawZones(idle.c,Z,b),false,'不看常驻底色：没有别的区域时不应画任何东西');
 assert.equal(idle.ops.length,0);
 // 起风窗口内仍然有全屏冰风
 runTo(b,25.2);
 assert.equal(drawIceWind(host().c,Z,b),true);
 // 区域本身没有被删掉：寒冷仍在按 25 秒周期施加
 assert.ok(b.s.logicEffects.some(fx=>fx.talentOrSkillId==='bond-kjerag-storm'&&fx.endsAt==null));
});
