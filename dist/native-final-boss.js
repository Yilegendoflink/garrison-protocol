// 逐名开放最终 Boss；未完成机制与路线验收的 Boss 不进入本局抽取池。
export const AVAILABLE_FINAL_BOSS_IDS=Object.freeze(['boss_4','boss_5','boss_7']);

// 逐名战斗机制登记（数值来源：盟约模式 PRTS 记录与对应敌人页）。
// hitRect＝实际受击矩形，与右上角预留的部署区是不同概念；盟约版昆图斯与萨米均为长4.95×宽2.95、向上偏移1；
// static＝自缚站桩（formHold，不沿环线移动）；unblockable＝不可阻挡；shiftImmune＝失衡免疫；
// range 补齐档案缺省的攻击半径（两位 Boss 的攻击都是全场范围，PRTS 攻击半径 99）。
// spriteScale 只管画布表现。
export const FINAL_BOSS_MECHANICS={
 'enemy_1521_dslily':{hitRect:{length:4.95,width:2.95,offsetY:1},spriteScale:3,static:true,unblockable:true,range:99},
 'enemy_2016_csphtm':{spriteScale:2.2},
 'enemy_9033_acdeer':{hitRect:{length:4.95,width:2.95,offsetY:1},spriteScale:3,static:true,unblockable:true,shiftImmune:true,range:99},
};
export function finalBossMechanics(enemyId){return FINAL_BOSS_MECHANICS[enemyId]||null;}
export function finalBossPlacementArea(map,enemyId){
 if(!finalBossMechanics(enemyId)?.static)return null;
 const columns=2,rows=3,firstColumn=map.cols-columns;
 return {left:firstColumn-.5,right:map.cols-.5,top:-.5,bottom:rows-.5,firstColumn,firstRow:0,columns,rows,x:firstColumn+(columns-1)/2,y:(rows-1)/2};
}
export function finalBossPlacementContains(area,x,y){return !!area&&x>=area.firstColumn&&x<area.firstColumn+area.columns&&y>=area.firstRow&&y<area.firstRow+area.rows;}
export function finalBossSpawnPoint(map,enemyId){
 const area=finalBossPlacementArea(map,enemyId);
 return area?{x:area.x,y:area.y}:null;
}

const HP_FIELD={FUNNY:'bloodPoint',NORMAL:'bloodPointNormal',HARD:'bloodPointHard',ABYSS:'bloodPointAbyss'};
export const DEFAULT_FINAL_BOSS_HP_MULTIPLIER=0.75;
export function normalizeFinalBossHpMultiplier(value){const n=Number(value);return Number.isFinite(n)?Math.round(Math.min(10,Math.max(.01,n))*100)/100:DEFAULT_FINAL_BOSS_HP_MULTIPLIER;}
function roll(seed){let x=(Number(seed)||1)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;}

export function rollFinalBoss(data,modeId,seed){
 const mode=data.season.modeDataDict[modeId],rows=AVAILABLE_FINAL_BOSS_IDS.map(id=>({id,config:data.season.bossInfoDict[id],enemy:data.common.bossInfoDict[id]})).filter(x=>x.config?.weight>0&&x.enemy?.enemyId&&data.finalBosses?.[x.id]);
 if(!rows.length)throw Error('没有已接入的最终 Boss');
 const total=rows.reduce((n,x)=>n+x.config.weight,0);let pick=roll((Number(seed)^0xb0555eed)>>>0)*total;
 return (rows.find(x=>(pick-=x.config.weight)<0)||rows.at(-1)).id;
}

export function finalBossConfig(data,bossId,modeId,hpMultiplier=DEFAULT_FINAL_BOSS_HP_MULTIPLIER){
 const source=data.common.bossInfoDict[bossId],settings=data.season.bossInfoDict[bossId],boss=data.finalBosses[bossId],difficulty=data.season.modeDataDict[modeId]?.modeDifficulty,profile=boss?.profiles?.[modeId]||boss?.profiles?.[difficulty==='TRAINING'?'mode_single_funny':null];
 if(!source||!settings||!profile)throw Error('最终 Boss 资料不完整：'+bossId);
 // 原表最终 Boss 生命按四人联机数据配置；本地模拟倍率默认 75%，由敌人编制配置并按每局固定。
 const multiplier=normalizeFinalBossHpMultiplier(hpMultiplier),hp=Number(settings[HP_FIELD[difficulty]]??settings.bloodPoint)*multiplier;
 if(!(hp>0))throw Error('最终 Boss 血量无效：'+bossId);
 return {...boss,enemyProfile:profile,bossId,hp,hpMultiplier:multiplier,weight:settings.weight,difficulty};
}
