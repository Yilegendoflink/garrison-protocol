import {blackboard} from './protocol.js';

// Branch defaults, separate from profession and skill overrides. Source/coverage is
// published in data/prts/branch-rules.json and in the in-game branch catalogue.
export const BRANCH_POLICIES={
 physician:{kind:'heal'},ringhealer:{kind:'heal',targets:3},healer:{kind:'heal',farHealRange:'2-3'},wandermedic:{kind:'heal',elementHealing:true},watchman:{kind:'heal',pending:['起飞与干员专属机制']},
 incantationmedic:{kind:'damage-heal',damageType:'arts',antiAir:true},chainhealer:{kind:'heal',style:'heal-chain',jumpRange:'x-4'},
 bard:{kind:'regeneration',attack:false,pending:['技能替换特性与鼓舞的专属效果']},
 phalanx:{damageType:'arts',antiAir:true,attackWhen:'skill',style:'all'},librator:{attackWhen:'skill',style:'single',charge:true},
 // 工匠「支援装置」已按 PRTS 召唤物页实现（落点全部位、屏障按装置自身攻击范围），不再挂 pending。
 craftsman:{damageType:'physical',pending:[]},blessing:{damageType:'arts',antiAir:true,healsDuringSkill:true},
 corecaster:{damageType:'arts',antiAir:true},artsfghter:{damageType:'arts'},artsprotector:{artsDuringSkill:true},primcaster:{damageType:'arts',antiAir:true,pending:['元素伤害机制']},primguard:{pending:['元素伤害机制']},primprotector:{pending:['元素损伤机制']},
 fastshot:{antiAir:true,priority:'air'},longrange:{antiAir:true,priority:'defense'},siegesniper:{antiAir:true,priority:'weight'},closerange:{antiAir:true},
 aoesniper:{antiAir:true,style:'splash',radius:1},splashcaster:{damageType:'arts',antiAir:true,style:'splash',radius:1.1},blastcaster:{damageType:'arts',antiAir:true,style:'all'},
 reaperrange:{antiAir:true,style:'all',frontScale:true},bombarder:{antiAir:false,style:'aftershock',radius:.9,pending:['余震时序']},hammer:{style:'hammer',radius:1},fortress:{style:'fortress',radius:1},
 centurion:{style:'block-count'},crusher:{style:'block-count'},pusher:{style:'block-count',highland:true},sword:{hits:2},
 lord:{antiAir:true,rangedPenalty:true},instructor:{unblockedBonus:true},
 reaper:{style:'all',noExternalHealing:true,selfHealing:'reaper'},musha:{noExternalHealing:true,selfHealing:'musha'},unyield:{noExternalHealing:true},
 slower:{damageType:'arts',antiAir:true,sluggish:.8},chain:{damageType:'arts',antiAir:true,style:'chain',jumpRadius:1.7,jumpScale:.85},
 mystic:{damageType:'arts',antiAir:true,storage:true},hunter:{antiAir:true,magazine:true},funnel:{damageType:'arts',antiAir:true,drone:true,pending:['技能释放浮游单元']},
 loopshooter:{returnProjectile:true,pending:['回旋轨迹与速度校准']},stalker:{style:'all',evasion:.5,taunt:-1},geek:{antiAir:true,hpDrain:.01},
 bearer:{blockZeroDuringSkill:true},agent:{antiAir:true},shotprotector:{antiAir:true},hookmaster:{antiAir:true,highland:true,pending:['位移力度与碰撞']},
 tactician:{antiAir:true,pending:['战术点与援军']},summoner:{damageType:'arts',antiAir:true,pending:['召唤物生命周期']},soulcaster:{damageType:'arts',antiAir:true,pending:['击杀召唤与召唤物索敌']},
 duelist:{spRequiresBlock:true,pending:['模组解除阻回的例外']},dollkeeper:{pending:['各模组替身专属例外']},skywalker:{pending:['起飞与空中阻挡']},skybreaker:{antiAir:true,airOnlyIdle:true,pending:['起飞／降落']},
 ritualist:{damageType:'arts',antiAir:true,pending:['元素损伤']},underminer:{damageType:'arts',antiAir:true},
 merchant:{},charger:{pending:['击杀回费与撤退费用返还']},traper:{antiAir:true,pending:['陷阱单位与部署条件']},alchemist:{pending:['炼金单元']},counsellor:{pending:['待部署区支援']},mercenary:{pending:['部署费用强化']}
};
// 技能级的对空覆盖：分支特性只决定**常态**能否打空，个别技能会改变这一点。
// 数据来源是 PRTS 干员页技能备注里的「※可对空」「※不可对空」「※攻击范围缩小时，不再攻击空中单位」
// （本地快照 data/prts/snapshots/*/operators.json 的 skills[i].sourceTemplate.fields.备注），
// 索引与预设的 skillIndex 一样是 0 起：{技能序号: 该技能生效时能否打空}。
// 这张表只写**与分支默认值不同**的技能；tests/native-air-targeting.test.mjs 会拿 PRTS 备注做门禁。
export const SKILL_ANTIAIR={
 char_102_texas:{1:true},     // 德克萨斯「剑雨」：※可对空
 char_202_demkni:{2:true},    // 塞雷娅「钙质化」：※可对空
 char_311_mudrok:{2:true},    // 泥岩「秽壤的血脉」：※减速效果可对飞行单位生效
 char_420_flamtl:{1:true},    // 焰尾「红松林」：※可对空
 char_4039_horn:{0:true},     // 号角「照明榴弹」：※照明效果可对空
 char_4064_mlynar:{2:true},   // 玛恩纳「未照耀的荣光」：※可对空
 char_4116_blkkgt:{2:true},   // 锏「归于宁静」：※可对空
 char_4026_vulpis:{1:true},   // 忍冬「坠刃拷问」：※可对空
 char_1028_texas2:{2:true},   // 缄默德克萨斯「剑雨滂沱」：※效果可对空
 char_172_svrash:{1:false}    // 银灰「雪境生存法则」：※攻击范围缩小时，不再攻击空中单位
};
export function skillAntiAir(charId,skillIndex){
 const row=SKILL_ANTIAIR[charId];
 return row&&skillIndex!=null&&Object.prototype.hasOwnProperty.call(row,skillIndex)?row[skillIndex]:null;
}
// 部署位：PRTS 分支特性写「可以放置于远程位」的两个分支（推击手／钩索师）既能上高台也能下地面，
// 其余近战分支仍然只能放地面。数据来源 data/prts/branch-rules.json 的 baseTrait，
// tests/native-deployment-placement.test.mjs 会拿它做门禁。
export function allowsHighlandPlacement(profile){
 return !!(BRANCH_POLICIES[profile?.branch]?.highland);
}
export function branchTrait(profile){
 const phase=profile.phase??Number(profile.status?.evolvePhase?.replace('PHASE_','')||0),level=profile.level??profile.status?.charLevel??1;
 const candidates=(profile.trait?.candidates||[]).filter(c=>{const required=Number(String(c.unlockCondition?.phase||'PHASE_0').replace('PHASE_',''));return required<phase||(required===phase&&(c.unlockCondition?.level||1)<=level);});
 const trait=candidates.at(-1);return {...trait,values:blackboard(trait?.blackboard)};
}
export function branchBehavior(profile,active=false){
 const rule=BRANCH_POLICIES[profile.branch]||{},kind=rule.healsDuringSkill&&active?'heal':rule.kind||(profile.profession==='MEDIC'?'heal':'damage');
 return {...rule,kind,style:rule.style||'single',damageType:rule.artsDuringSkill&&active?'arts':rule.damageType||(['CASTER','SUPPORT'].includes(profile.profession)?'arts':'physical'),antiAir:rule.antiAir??(profile.position==='RANGED'),attack:rule.attack!==false&&!(rule.attackWhen==='skill'&&!active)};
}
