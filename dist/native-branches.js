import {blackboard} from './protocol.js';

// Branch defaults, separate from profession and skill overrides. Source/coverage is
// published in data/prts/branch-rules.json and in the in-game branch catalogue.
export const BRANCH_POLICIES={
 physician:{kind:'heal'},ringhealer:{kind:'heal',targets:3},healer:{kind:'heal',farHealRange:'2-3'},wandermedic:{kind:'heal',elementHealing:true},watchman:{kind:'heal',pending:['起飞与干员专属机制']},
 incantationmedic:{kind:'damage-heal',damageType:'arts',antiAir:true},chainhealer:{kind:'heal',style:'heal-chain',jumpRange:'x-4'},
 bard:{kind:'regeneration',attack:false,pending:['技能替换特性与鼓舞的专属效果']},
 phalanx:{damageType:'arts',antiAir:true,attackWhen:'skill',style:'all'},librator:{attackWhen:'skill',style:'single',charge:true},
 craftsman:{damageType:'physical',pending:['支援装置']},blessing:{damageType:'arts',antiAir:true,healsDuringSkill:true},
 corecaster:{damageType:'arts',antiAir:true},artsfghter:{damageType:'arts'},artsprotector:{artsDuringSkill:true},primcaster:{damageType:'arts',antiAir:true,pending:['元素伤害机制']},primguard:{pending:['元素伤害机制']},primprotector:{pending:['元素损伤机制']},
 fastshot:{antiAir:true,priority:'air'},longrange:{antiAir:true,priority:'defense'},siegesniper:{antiAir:true,priority:'weight'},closerange:{antiAir:true},
 aoesniper:{antiAir:true,style:'splash',radius:1},splashcaster:{damageType:'arts',antiAir:true,style:'splash',radius:1.1},blastcaster:{damageType:'arts',antiAir:true,style:'all'},
 reaperrange:{antiAir:true,style:'all',frontScale:true},bombarder:{antiAir:false,style:'aftershock',radius:.9,pending:['余震时序']},hammer:{style:'hammer',radius:1},fortress:{style:'fortress',radius:1},
 centurion:{style:'block-count'},crusher:{style:'block-count'},pusher:{style:'block-count'},sword:{hits:2},
 lord:{antiAir:true,rangedPenalty:true},instructor:{unblockedBonus:true},
 reaper:{style:'all',noExternalHealing:true,selfHealing:'reaper'},musha:{noExternalHealing:true,selfHealing:'musha'},unyield:{noExternalHealing:true},
 slower:{damageType:'arts',antiAir:true,sluggish:.8},chain:{damageType:'arts',antiAir:true,style:'chain',jumpRadius:1.7,jumpScale:.85},
 mystic:{damageType:'arts',antiAir:true,storage:true},hunter:{antiAir:true,magazine:true},funnel:{damageType:'arts',antiAir:true,drone:true,pending:['技能释放浮游单元']},
 loopshooter:{returnProjectile:true,pending:['回旋轨迹与速度校准']},stalker:{style:'all',evasion:.5,taunt:-1},geek:{antiAir:true,hpDrain:.01},
 bearer:{blockZeroDuringSkill:true},agent:{antiAir:true},shotprotector:{antiAir:true},hookmaster:{antiAir:true,pending:['位移力度与碰撞']},
 tactician:{antiAir:true,pending:['战术点与援军']},summoner:{damageType:'arts',antiAir:true,pending:['召唤物生命周期']},soulcaster:{damageType:'arts',antiAir:true,pending:['击杀召唤与召唤物索敌']},
 duelist:{spRequiresBlock:true,pending:['模组解除阻回的例外']},dollkeeper:{pending:['替身切换与Buff清理']},skywalker:{pending:['起飞与空中阻挡']},skybreaker:{antiAir:true,airOnlyIdle:true,pending:['起飞／降落']},
 ritualist:{damageType:'arts',antiAir:true,pending:['元素损伤']},underminer:{damageType:'arts',antiAir:true},
 merchant:{},charger:{pending:['击杀回费与撤退费用返还']},traper:{antiAir:true,pending:['陷阱单位与部署条件']},alchemist:{pending:['炼金单元']},counsellor:{pending:['待部署区支援']},mercenary:{pending:['部署费用强化']}
};
export function branchTrait(profile){
 const phase=profile.phase??Number(profile.status?.evolvePhase?.replace('PHASE_','')||0),level=profile.level??profile.status?.charLevel??1;
 const candidates=(profile.trait?.candidates||[]).filter(c=>{const required=Number(String(c.unlockCondition?.phase||'PHASE_0').replace('PHASE_',''));return required<phase||(required===phase&&(c.unlockCondition?.level||1)<=level);});
 const trait=candidates.at(-1);return {...trait,values:blackboard(trait?.blackboard)};
}
export function branchBehavior(profile,active=false){
 const rule=BRANCH_POLICIES[profile.branch]||{},kind=rule.healsDuringSkill&&active?'heal':rule.kind||(profile.profession==='MEDIC'?'heal':'damage');
 return {...rule,kind,style:rule.style||'single',damageType:rule.artsDuringSkill&&active?'arts':rule.damageType||(['CASTER','SUPPORT'].includes(profile.profession)?'arts':'physical'),antiAir:rule.antiAir??(profile.position==='RANGED'),attack:rule.attack!==false&&!(rule.attackWhen==='skill'&&!active)};
}
