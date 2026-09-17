import {buildPhasePlan} from './protocol.js';
import {TRAINING_TYPES,PLACEHOLDER_ENEMY,loadWaveTable,enemyCost,tierPack,templateLabel} from './native-wave-fill.js';

const A=(n,extra=1)=>extra*(1.1**n);
const H=(n,extra=1)=>extra*(1.2**n);

// PRTS 下半页用户表，页面声明不保证准确。列：标准 / 险境 / 绝境 / 终极。
const ATK={
 single:{
  FUNNY:{1:.7,2:.7,3:.7,4:.7,5:.7,6:.7,7:.7,8:.7,9:.7},
  NORMAL:{1:.7,2:.7,3:.7,4:A(1,.7),5:A(1,.7),6:A(1,.7),7:A(1,.7),8:A(2,.7),9:A(2,.7),10:A(2,.7),11:A(3,.7),12:A(4,.7),13:A(5,.7),14:A(5,.7)},
  HARD:{1:.8,2:.8,3:.8,4:.8,5:A(1,.8),6:A(1,.8),7:A(1,.8),8:A(1,.8),9:A(2,.8),10:A(2,.8),11:A(3,.8),12:A(3,.8),13:A(4,.8),14:A(4,.8),hidden:A(4,.8)},
  ABYSS:{1:A(1),2:A(2),3:A(2),4:A(2),5:A(2),6:A(3),7:A(3),8:A(3),9:A(3),10:A(4),11:A(5),12:A(5),13:A(6),14:A(7),hidden:A(7)}
 },
 multi:{
  FUNNY:{1:.8,2:.8,3:.8,4:.8,5:.8,6:.8,7:.8,8:.8,9:.8,10:.8,11:.8,12:A(1,.8),13:A(1,.8),14:A(1,.8)},
  NORMAL:{1:.8,2:A(1,.8),3:A(1,.8),4:A(2,.8),5:A(2,.8),6:A(2,.8),7:A(2,.8),8:A(3,.8),9:A(4,.8),10:A(4,.8),11:A(5,.8),12:A(6,.8),13:A(7,.8),14:A(7,.8)},
  HARD:{1:A(1),2:A(2),3:A(2),4:A(3),5:A(3),6:A(3),7:A(3),8:A(3),9:A(4),10:A(5),11:A(6),12:A(6),13:A(7),14:A(8),hidden:A(8)},
  ABYSS:{1:A(1),2:A(2),3:A(2),4:A(3),5:A(3),6:A(4),7:A(5),8:A(5),9:A(5),10:A(5),11:A(6),12:A(6),13:A(7),14:A(8),hidden:A(8)}
 }
};
const HP={
 single:{
  FUNNY:{1:.7,2:.7,3:.7,4:.7,5:.7,6:.7,7:.7,8:.7,9:.7},
  NORMAL:{1:.7,2:.7,3:.7,4:H(1,.7),5:H(1,.7),6:H(1,.7),7:H(1,.7),8:H(2,.7),9:H(2,.7),10:H(2,.7),11:H(3,.7),12:H(4,.7),13:H(5,.7),14:H(5,.7)},
  HARD:{1:.8,2:.8,3:.8,4:.8,5:H(1,.8),6:H(1,.8),7:H(1,.8),8:H(1,.8),9:H(2,.8),10:H(2,.8),11:H(3,.8),12:H(3,.8),13:H(4,.8),14:H(4,.8),hidden:H(4,.8)},
  ABYSS:{1:H(1),2:H(2),3:H(2),4:H(2),5:H(2),6:H(3),7:H(3),8:H(3),9:H(3),10:H(4),11:H(5),12:H(5),13:H(6),14:H(7),hidden:H(7)}
 },
 multi:{
  FUNNY:{1:.8,2:.8,3:.8,4:.8,5:.8,6:.8,7:.8,8:.8,9:.8,10:.8,11:.8,12:H(1,.8),13:H(1,.8),14:H(1,.8)},
  NORMAL:{1:.8,2:H(1,.8),3:H(1,.8),4:H(2,.8),5:H(2,.8),6:H(2,.8),7:H(2,.8),8:H(3,.8),9:H(4,.8),10:H(4,.8),11:H(5,.8),12:H(6,.8),13:H(7,.8),14:H(7,.8)},
  HARD:{1:H(1),2:H(2),3:H(2),4:H(3),5:H(3),6:H(3),7:H(3),8:H(3),9:H(4),10:H(5),11:H(6),12:H(6),13:H(7),14:H(8),hidden:H(8)},
  ABYSS:{1:H(1),2:H(2),3:H(2),4:H(3),5:H(4),6:H(4,1.08),7:H(7),8:H(8),9:H(8),10:H(8),11:H(9),12:H(10),13:H(10,1.08),14:H(10,1.08),hidden:H(10,1.08)}
 }
};

export function trainingType(id){return TRAINING_TYPES.find(t=>t.id===id)||null;}
export function difficultyColumn(modeDifficulty){return modeDifficulty==='ABYSS'?'ABYSS':modeDifficulty==='HARD'?'HARD':modeDifficulty==='NORMAL'?'NORMAL':'FUNNY';}
export function scaleSide(modeType){return modeType==='MULTI'?'multi':'single';}

function tableValue(table,round,hidden){
 if(hidden&&table.hidden!=null)return table.hidden;
 if(table[round]!=null)return table[round];
 const nums=Object.keys(table).filter(k=>k!=='hidden').map(Number).filter(Number.isFinite);
 return table[Math.max(...nums)]??.7;
}
export function enemyCombatScale(mode,round,{hidden=false}={}){
 const side=scaleSide(mode.modeType),col=difficultyColumn(mode.modeDifficulty);
 const atkTable=ATK[side][col],hpTable=HP[side][col];
 const atk=tableValue(atkTable,round,hidden),hp=tableValue(hpTable,round,hidden);
 const moveSpeed=col==='ABYSS'&&(hidden||round>=3)?1.15:1;
 return {atk,hp,moveSpeed,side,column:col};
}

export function pressureTier(round,combatRounds){if(round<=3)return 1;if(round<=9)return 2;return 3;}

export function pickDistinct(random,items,count){
 const pool=items.slice();const chosen=[];
 while(chosen.length<count&&pool.length)chosen.push(pool.splice(Math.floor(random()*pool.length),1)[0]);
 return chosen;
}

export function createWaveRoster({random,data,modeId}){
 const types=pickDistinct(random,TRAINING_TYPES.map(t=>t.id),3);
 const plan=buildPhasePlan(data,modeId);
 const combat=plan.filter(t=>!t.isBossTurn).map(t=>t.round);
 const order=types.slice();
 for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 const rounds={};
 for(const turn of plan){
  if(turn.isBossTurn){rounds[turn.round]={boss:true,type:null,tier:null,waveSeed:null};continue;}
  rounds[turn.round]={boss:false,type:order[combat.indexOf(turn.round)%order.length],tier:pressureTier(turn.round,combat),waveSeed:Math.floor(random()*0xffffffff)>>>0};
 }
 return {version:2,modeId,types,order,rounds};
}

export function waveRng(seed){let x=(seed||1)>>>0;const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};next();return next;}

export function fillBudgetWave(random,table,type,tier){
 const list=tierPack(table,type,tier).templates;
 const templateIndex=list.length<=1?0:Math.floor(random()*list.length);
 const slot=list[templateIndex]||list[0],budget=Math.max(0,Number(slot.budget)||0),maxCost=Number(slot.maxCost),pool=(slot.pool||[]).filter(Boolean).filter(id=>!(Number.isFinite(maxCost)&&maxCost>0)||enemyCost(table,id)<=maxCost);
 const meta={templateIndex,templateName:templateLabel(slot,templateIndex),budget};
 if(!pool.length)return {ids:[PLACEHOLDER_ENEMY],spent:0,leftover:budget,unfilled:true,...meta};
 const targetCount=slot.minCount?slot.minCount+Math.floor(random()*(slot.maxCount-slot.minCount+1)):80;
 const ids=[];let spent=0;
 for(let n=0;n<targetCount;n++){
  const fit=pool.filter(id=>enemyCost(table,id)<=budget-spent);if(!fit.length)break;
  const id=fit[Math.floor(random()*fit.length)];ids.push(id);spent+=enemyCost(table,id);
 }
 return {ids,spent,leftover:budget-spent,unfilled:false,...meta};
}

// Keep the editable wave table intact, but prevent explicitly complex enemy
// behaviors from leaking into the random pool before they have fixed-wave tests.
export function filterRandomPoolTable(table,data){
 if(!data?.enemies)return table;
 const out=structuredClone(table);
 for(const type of Object.values(out.types||{}))for(const tier of Object.values(type||{}))for(const slot of tier?.templates||[]){
  slot.pool=(slot.pool||[]).filter(id=>data.enemies[id]&&data.enemies[id].enemyBehavior?.randomPoolEligible!==false);
 }
 return out;
}

function visibleRoutes(level,fly){
 return (level.routes||[]).map((route,index)=>({route,index})).filter(({route})=>route&&route.startPosition.col<=10&&route.startPosition.row>=6&&route.startPosition.row<=12&&(fly?route.motionMode==='FLY':route.motionMode!=='FLY'));
}

export function buildWavePlan(data,turn,roster=null,table=null){
 if(!turn)return null;
 if(turn.isBossTurn)return {round:turn.round,benchmark:true,total:0,targets:1,queue:[],level:null,levelId:null,assignment:null};
 const levelId=turn.battles[0]?.levelId.toLowerCase(),level=data.levels[levelId];if(!level)throw Error('缺少关卡模板 '+levelId);
 const assignment=roster?.rounds?.[turn.round];
 if(!assignment||assignment.boss)return {round:turn.round,benchmark:false,total:0,targets:0,queue:[],level,levelId,assignment:assignment||null};
 const ground=visibleRoutes(level,false),air=visibleRoutes(level,true),queue=[],mode=data.season.modeDataDict[roster.modeId];
 const scale=mode?enemyCombatScale(mode,turn.round,{hidden:!!turn.isConditional}):{atk:1,hp:1,moveSpeed:1};
 const sourceTable=table||loadWaveTable(),waveTable=filterRandomPoolTable(sourceTable,data),pack=fillBudgetWave(waveRng(assignment.waveSeed||turn.round),waveTable,assignment.type,assignment.tier);
 const interval=pack.ids.length<=1?0:Math.max(1.2,Math.min(4,24/pack.ids.length));
 pack.ids.forEach((id,i)=>{
  const fly=(data.enemies?.[id]||level.enemyProfiles?.[id])?.motion==='FLY';
  const routes=fly?(air.length?air:ground):(ground.length?ground:air);if(!routes.length)return;
  const pick=routes[i%routes.length];
  queue.push({id,at:2+i*interval,route:pick.index,cost:enemyCost(waveTable,id),placeholder:pack.unfilled,unfilled:pack.unfilled});
 });
 return {round:turn.round,benchmark:false,total:queue.length,targets:queue.length,queue,level,levelId,assignment,scale,pack,filled:pack.unfilled?0:queue.length,placeholders:pack.unfilled?queue.length:0};
}
