import {enemyPoolEligible} from './native-wave-fill.js';

// 原表编组完整准入：不能过滤掉某个成员后仍把残组当成原版编组。
export function originalEnemyGroups(data,modeId,types,firstHalf){
 const banned=new Set(data.season.modeDataDict[modeId]?.inactiveEnemyKey||[]),allowed=new Set(types);
 return Object.values(data.season.specialEnemyInfoDict||{}).filter(group=>
  (group.type==='SPECIAL'||allowed.has(group.type))&&group.isInFirstHalf===firstHalf&&group.randomWeight>0&&
  [group.specialEnemyKey,...group.attachedNormalEnemyKeys,...group.attachedEliteEnemyKeys].every(id=>data.enemies[id]&&!banned.has(id)&&enemyPoolEligible(id,data)));
}

export function pickWeightedGroup(random,groups){
 const total=groups.reduce((n,g)=>n+g.randomWeight,0);if(!total)throw Error('当前阶段没有完整准入的原版敌人编组');
 let roll=random()*total;
 for(const group of groups){roll-=group.randomWeight;if(roll<0)return group;}
 return groups.at(-1);
}

export function originalWaveQueue(data,level,group){
 const constants=data.common.constData,fly=data.enemies[group.specialEnemyKey].motion==='FLY';
 const roles=new Map([
  [constants[fly?'templateEnemyNormalFly':'templateEnemyNormal'],['normal',group.attachedNormalEnemyKeys[0]]],
  [constants[fly?'templateEnemyEliteFly':'templateEnemyElite'],['elite',group.attachedEliteEnemyKeys[0]]],
  [constants[fly?'templateEnemySpecialFly':'templateEnemySpecial'],['special',group.specialEnemyKey]]
 ]),allTemplates=new Set(['templateEnemyNormal','templateEnemyElite','templateEnemySpecial','templateEnemyNormalFly','templateEnemyEliteFly','templateEnemySpecialFly'].map(key=>constants[key]));
 const queue=[];let waveAt=0;
 for(const wave of level.waves||[]){
  waveAt+=Number(wave.preDelay)||0;let fragmentAt=waveAt,lastAt=waveAt;
  for(const fragment of wave.fragments||[]){
   fragmentAt+=Number(fragment.preDelay)||0;
   for(const action of fragment.actions||[]){
    const route=level.routes[action.routeIndex];
    if(action.actionType!=='SPAWN'||!route||route.startPosition.col>10||route.startPosition.row<6||route.startPosition.row>12)continue;
    const role=roles.get(action.key);
    if(!role&&allTemplates.has(action.key))continue;
    const id=role?.[1]||action.key;
    if(!data.enemies[id])throw Error('原版波次缺少敌人资料 '+id);
    for(let i=0;i<action.count;i++){
     const at=fragmentAt+(Number(action.preDelay)||0)+i*(Number(action.interval)||0);
     queue.push({id,at,route:action.routeIndex,role:role?.[0]||'fixed',original:true,cost:0});lastAt=Math.max(lastAt,at);
    }
   }
  }
  waveAt=lastAt+(Number(wave.postDelay)||0);
 }
 // ponytail: 数量沿用模板槽位；服务器战斗力换算与取整未核定，取证后在此替换数量计算。
 return queue.sort((a,b)=>a.at-b.at||a.route-b.route);
}
