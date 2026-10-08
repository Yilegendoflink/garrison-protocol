import fs from 'node:fs/promises';
import {resolveChess,applyEnemyOverrides,richText} from '../dist/protocol.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
import {applySeesContent} from './lib/sees-content.mjs';
import {validateWeeklyChallengeSchedule} from '../dist/native-challenges.js';
import {AVAILABLE_FINAL_BOSS_IDS} from '../dist/native-final-boss.js';
const DEFAULT_CULTIVATION_BONUS={atk:0.1,def:0.1,maxHp:0.1};
const source=JSON.parse(await fs.readFile('data/modes/alliance-lower/source.json','utf8')),base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8')),catalog=JSON.parse(await fs.readFile('data/modes/alliance-lower/catalog.json','utf8')),behaviorConfig=JSON.parse(await fs.readFile('data/modes/alliance-lower/enemy-behavior-overrides.json','utf8')),behaviorOverrides=behaviorConfig.overrides||{},manifest=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/manifest.json','utf8')),characterTable=JSON.parse(await fs.readFile('data/gamedata/allianceLower/character_table.json','utf8')),enemyHandbook=JSON.parse(await fs.readFile('data/gamedata/allianceLower/enemy_handbook_table.json','utf8'));
const weeklyChallengeSchedule=JSON.parse(await fs.readFile('data/modes/alliance-lower/weekly-challenges.json','utf8'));
const weeklyChallengeErrors=validateWeeklyChallengeSchedule(weeklyChallengeSchedule,{modeIds:new Set([...Object.keys(source.season.modeDataDict),'mode_325','mode_cat_all']),mapIds:new Set(catalog.maps.filter(map=>map.weight>0).map(map=>map.stageId)),finalBossIds:new Set(AVAILABLE_FINAL_BOSS_IDS)});
if(weeklyChallengeErrors.length)throw Error('Invalid weekly challenge schedule:\n'+weeklyChallengeErrors.join('\n'));
const enemyCostEffects={};for(const [id,entry] of Object.entries(enemyHandbook.enemyData||{})){if(id==='enemy_2008_flking')continue;/* PRTS：墓碑图鉴中的全场削弱属于原关卡，不能烘成敌人天赋。 */const text=(entry.abilityList||[]).map(x=>x.text||'').join(' '),effects=[];if(/部署费用回复速度减半/.test(text))effects.push({costRecoveryMultiplier:.5});if(/再部署时间加倍/.test(text))effects.push({respawnTimeMultiplier:2});if(/封锁我方部署费用的自然回复/.test(text))effects.push({costRecoveryMultiplier:0});if(effects.length)enemyCostEffects[id]=effects;}
// 普攻伤害类型的权威来源：敌人图鉴的 damageType（PHYSIC／MAGIC／NO_DAMAGE，多类型按原表顺序，第一项是常态）。
// 客户端不再从描述文本猜类型（见 dist/native-battle.js 的 enemyBaseDamageType）。
const enemyDamageTypes=Object.fromEntries(Object.entries(enemyHandbook.enemyData||{}).map(([id,entry])=>[id,Array.isArray(entry.damageType)&&entry.damageType.length?entry.damageType:null]));
// PRTS 图鉴 codexId 对应原始敌人索引；按图鉴「种类」给运行时档案加只读分类，周挑战据此筛敌池。
const prtsSnapshotDirs=(await fs.readdir('data/prts/snapshots',{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
const prtsEnemySnapshot=prtsSnapshotDirs.length?JSON.parse(await fs.readFile(`data/prts/snapshots/${prtsSnapshotDirs.at(-1)}/enemies.json`,'utf8')):[];
const prtsRaceByEnemyIndex=new Map(prtsEnemySnapshot.map(enemy=>[enemy.codexId,enemy.race]).filter(([id,race])=>id&&race));
const prtsRaceByEnemyId=Object.fromEntries(Object.entries(base.enemies||{}).map(([id,enemy])=>[id,prtsRaceByEnemyIndex.get(enemy.codex?.enemyIndex)]).filter(([,race])=>race));
for(const challenge of weeklyChallengeSchedule.entries)for(const effect of challenge.effects||[])if(effect.hook==='enemy.pool'&&effect.type==='filter-prts-kind'){
 const kind=effect.params?.kind,available=catalog.enemies.filter(enemy=>enemy.kinds?.includes('random-pool')&&prtsRaceByEnemyId[enemy.id]===kind&&enemy.enemyBehavior?.randomPoolEligible!==false);
 if(!available.length)throw Error(`每周挑战 ${challenge.id} 没有可用的 PRTS「${kind}」敌人`);
 if(challenge.finalBossId){const enemyId=source.common.bossInfoDict[challenge.finalBossId]?.enemyId;if(prtsRaceByEnemyId[enemyId]!==kind)throw Error(`每周挑战 ${challenge.id} 的最终首领不属于 PRTS「${kind}」种类`);}
}
const virtualChess=[['chess_virtual_prepared_medic','char_605_cmedic',4,0],['chess_virtual_touch','char_613_acmedc',6,2]];for(const[chessId,charId,chessLevel,defaultSkillIndex]of virtualChess){const template=source.season.charChessDataDict[Object.keys(source.season.charChessDataDict).find(id=>source.season.charChessDataDict[id].isGolden===false)];source.season.charChessDataDict[chessId]={...structuredClone(template),chessId,isGolden:false,charId,bondIds:[],garrisonIds:[],status:{...template.status,evolvePhase:'PHASE_2',charLevel:1,skillLevel:1,equipLevel:0}};source.season.charShopChessDatas[chessId]={chessId,goldenChessId:null,chessLevel,shopLevelSortId:999,chessType:'NORMAL',charId,tmplId:null,defaultSkillIndex,isHidden:true};}
// 联动干员（S.E.E.S. 四人组）：口径见 data/modes/alliance-lower/collab-operators.json——只建隐藏档进技能测试场，
// 不给盟约、不给卫戍、不进商店池。数值不抄写：实体／技能／范围从全局数据 data/normalized/current.json（rel77.0）取，
// 这里只用登记表里的 charId／chessId／档位把两边接起来。
const collab=JSON.parse(await fs.readFile('data/modes/alliance-lower/collab-operators.json','utf8')),collabBase=JSON.parse(await fs.readFile('data/normalized/current.json','utf8')),collabCharacterTable=JSON.parse(await fs.readFile('data/gamedata/current/character_table.json','utf8'));
const collabCharacters={};for(const op of collab.operators){const entity=collabBase.entities[op.charId];if(!entity)throw Error('联动干员缺实体 '+op.charId);const phase=entity.phases[Math.min(entity.phases.length-1,Number(String(op.status.evolvePhase).replace('PHASE_','')))];if(!phase||op.status.charLevel>phase.maxLevel)throw Error('联动干员档位越界 '+op.charId);if(Number(entity.rarity)!==op.rarity)throw Error('联动干员星级与数据不符 '+op.charId);base.entities[op.charId]=entity;collabCharacters[op.charId]=collabCharacterTable[op.charId]||{};for(const p of entity.phases)if(p.rangeId&&collabBase.ranges[p.rangeId]&&!base.ranges[p.rangeId])base.ranges[p.rangeId]=collabBase.ranges[p.rangeId];for(const slot of entity.talents||[])for(const c of slot.candidates||[])if(c.rangeId&&collabBase.ranges[c.rangeId]&&!base.ranges[c.rangeId])base.ranges[c.rangeId]=collabBase.ranges[c.rangeId];for(const c of entity.trait?.candidates||[])if(c.rangeId&&collabBase.ranges[c.rangeId]&&!base.ranges[c.rangeId])base.ranges[c.rangeId]=collabBase.ranges[c.rangeId];for(const ref of entity.skillRefs||[]){const skill=collabBase.skills[ref.skillId];if(skill&&!base.skills[ref.skillId])base.skills[ref.skillId]=skill;for(const level of skill?.levels||[])if(level.rangeId&&collabBase.ranges[level.rangeId]&&!base.ranges[level.rangeId])base.ranges[level.rangeId]=collabBase.ranges[level.rangeId];}source.season.charChessDataDict[op.chessId]={chessId:op.chessId,identifier:0,isGolden:false,upgradeChessId:null,upgradeNum:0,charId:op.charId,bondIds:[],garrisonIds:[],status:{...op.status}};source.season.charShopChessDatas[op.chessId]={chessId:op.chessId,goldenChessId:null,chessLevel:op.chessLevel,shopLevelSortId:999,chessType:'NORMAL',charId:op.charId,tmplId:null,defaultSkillIndex:op.defaultSkillIndex||0,isHidden:true};}
// S.E.E.S. 策略内容：必须在联动干员建完档之后注入——上面那段会重建 charChessDataDict[chessId]（bondIds:[]），
// 先注入会被它覆盖回去。四人从此挂上 seesShip，商店记录带 sees 标记，臂章与两条盟约同时就位。
applySeesContent(source);
const profiles={};for(const shop of Object.values(source.season.charShopChessDatas)){if(!shop.charId)continue;const entity=base.entities[shop.tmplId||shop.charId],rawCharacter=characterTable[shop.tmplId||shop.charId]||collabCharacters[shop.tmplId||shop.charId]||{};for(const id of [shop.chessId,shop.goldenChessId]){if(!id)continue;const states=[];for(let i=0;i<entity.skillRefs.length;i++)states.push(resolveChess(source,base,id,{skillIndex:i}));const selected=resolveChess(source,base,id);profiles[id]={...selected,profession:entity.profession,branch:entity.branch,position:entity.position,groupId:rawCharacter.groupId??null,teamId:rawCharacter.teamId??null,skillChoices:states,asset:catalog.roster.find(r=>r.charId===shop.charId)?.asset};}}
const catalogById=Object.fromEntries(catalog.enemies.map(e=>[e.id,e]));
// 敌人档案统一入口：把行为覆盖 JSON 和 enemyBehaviorProfile 推导出的能力（持续伤害区域、
// 流血、抵抗等）一起写进 enemyBehavior。客户端读到的 runtime-data 因此自带这些字段，
// 不会因为快照丢失原始 skills 表而退化成空行为。
const buildEnemyProfile=(id,rawData,catalogEnemy,extra={})=>{const profile={...rawData,damageTypes:enemyDamageTypes[id]||null,ability:catalogEnemy?.ability||base.enemies[id]?.codex?.abilityList||[],kinds:catalogEnemy?.kinds||[],categories:catalogEnemy?.categories||[],...(prtsRaceByEnemyId[id]?{prtsRace:prtsRaceByEnemyId[id]}:{}),costEffects:enemyCostEffects[id]||[],...extra,enemyBehavior:behaviorOverrides[id]};return {...profile,enemyBehavior:enemyBehaviorProfile(profile)};};
const levels={};for(const[id,entry]of Object.entries(manifest.files)){const l=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/'+entry.file,'utf8'));const enemyProfiles={};for(const ref of l.enemyDbRefs||[]){const raw=base.enemies[ref.id]?.levels.find(x=>x.level===ref.level),catalogEnemy=catalogById[ref.id];if(raw)enemyProfiles[ref.id]=buildEnemyProfile(ref.id,applyEnemyOverrides(raw.data,ref.overwrittenData),catalogEnemy);}levels[id]={routes:l.routes,waves:l.waves,enemyProfiles};}
// 正式最终战需要领袖原表关卡覆盖（例如卢西恩的本期攻击 600），不把领袖塞进道中随机池。
const finalBosses={};
for(const[modeId,rounds]of Object.entries(source.season.battleDataDict)){
 const turn=Object.values(source.common.turnInfoDataDict[modeId]||{}).filter(x=>x.isBossTurn&&x.round!==15).at(-1);if(!turn)continue;
 for(const row of rounds[turn.round]||[]){const cfg=source.common.bossInfoDict[row.bossId],profile=levels[row.levelId.toLowerCase()]?.enemyProfiles?.[cfg?.enemyId];if(cfg&&profile){finalBosses[row.bossId]??={enemyId:cfg.enemyId,handbookEnemyId:cfg.handbookEnemyId,profiles:{}};finalBosses[row.bossId].profiles[modeId]=profile;}}
}
const assets=JSON.parse(await fs.readFile('dist/assets/prts/manifest.json','utf8'));const branchRules=JSON.parse(await fs.readFile('data/prts/branch-rules.json','utf8'));const data={...source,sees:catalog.sees||null,tokens:Object.fromEntries(Object.entries(base.entities).filter(([id])=>id.startsWith('token_'))),branchRules,profiles,ranges:base.ranges,maps:catalog.maps,enemies:Object.fromEntries(catalog.enemies.map(e=>[e.id,buildEnemyProfile(e.id,e.data,e)])) ,items:catalog.items,assets:Object.fromEntries(Object.entries(assets.assets).map(([id,a])=>[id,a.file])),levels,enemyIndex:catalog.enemies.map(e=>{const a=e.data?.attributes||{},profile=buildEnemyProfile(e.id,e.data,e);return {id:e.id,name:e.name,kinds:profile.kinds||[],categories:profile.categories||[],motion:e.data?.motion||'WALK',applyWay:e.data?.applyWay||'',hp:a.maxHp??0,atk:a.atk??0,def:a.def??0,res:a.magicResistance??0,speed:a.moveSpeed??0,interval:a.baseAttackTime??0,tags:e.data?.enemyTags||[],desc:richText(e.data?.description||'')+(profile.enemyBehavior.scopeNote?' '+profile.enemyBehavior.scopeNote:''),enemyBehavior:profile.enemyBehavior};}),limitations:['商店刷新先按当前等级掷出阶级（最高阶30%、次高阶40%、更低阶合计30%），再从该阶级的剩余库存里抽；掷中的阶级没有库存时回落到整池随机抽。','技能通用属性、技力与弹药已接入；特殊召唤、形态、动画释放帧和部分敌人能力仍存在差异。','部分复杂策略、地图环境和装备联动尚未完整实现，请通过反馈入口记录。','道中默认从本局三类特训与通用编组按原表权重抽取，保留批次时间和路线；数量暂沿原模板，服务器换算未核定。自定义预算模式保留。生命／攻击倍率沿用既定口径。'],version:'manual-2026-09-13'};
data.cultivationBonus=DEFAULT_CULTIVATION_BONUS;
data.weeklyChallenges=weeklyChallengeSchedule;
data.finalBosses=finalBosses;
// 实现的召唤能力需要子实体档案，但子实体不扩充可选敌人目录/随机词条池。
data.enemyDependencies={};
// 两型集团军指挥员与中立矿工；作为交互依赖编入，不增补随机池或地图波次。
for(const id of ['enemy_10125_uacomd','enemy_10125_uacomd_2','enemy_3010_mcreep']){const entry=base.enemies[id]?.levels.find(x=>x.level===0);if(entry)data.enemyDependencies[id]=buildEnemyProfile(id,entry.data,catalogById[id]);}
// 卢西恩闪现的召唤依赖保留本期关卡覆盖（幻影攻击200），不能回退通用图鉴750。
const phantomLevel=Object.values(levels).find(l=>l.enemyProfiles?.enemy_2016_csphtm&&l.enemyProfiles?.enemy_2017_csphts);
if(phantomLevel)data.enemyDependencies.enemy_2017_csphts=phantomLevel.enemyProfiles.enemy_2017_csphts;
const pending=Object.values(data.enemies).concat(Object.values(levels).flatMap(l=>Object.values(l.enemyProfiles)));
for(let i=0;i<pending.length;i++)for(const spec of [pending[i].enemyBehavior?.spawnOnDeath,pending[i].enemyBehavior?.periodicSpawn]){
 const id=spec?.enemyKey;if(!id||data.enemies[id]||data.enemyDependencies[id])continue;
 const entry=base.enemies[id]?.levels.find(x=>x.level===0);if(!entry)throw Error('Missing summoned enemy '+id);
 const profile=buildEnemyProfile(id,entry.data,catalogById[id]);data.enemyDependencies[id]=profile;pending.push(profile);
}
// 全局控制器可能位于裁切范围外，不能用可见 devices 的筛选结果代替。
const skillTable=JSON.parse(await fs.readFile('data/gamedata/allianceLower/skill_table.json','utf8'));
data.mineCamp={attributes:characterTable.trap_270_spawnp.phases[0].attributesKeyFrames[0].data,skill:skillTable.sktok_spawnp.levels[0]};
// Dor回技力只认未激活的四种装置；不能把测试用/已激活敌方装甲混入。
data.powerArmorSkills=Object.fromEntries(['trap_075_bgarmn','trap_076_bgarms','trap_077_rmtarmn','trap_078_rmtarms'].map(id=>{const skillId=characterTable[id].skills[0].skillId;return [id,{skillId,...skillTable[skillId].levels[0]}];}));
// 源石流发生装置（吹风）的作用距离：取装置自身的**攻击范围**（character_table 的 phase.rangeId → range_table），
// 减去装置所在格就是「向前方 3 格」，与技能文案一致；位置取 map.windSources（不裁切，见 build-protocol）。
const blowerRange=data.ranges[characterTable.trap_013_blower?.phases?.[0]?.rangeId]?.grids||[];
const BLOWER_LENGTH=Math.max(1,blowerRange.filter(cell=>cell.col||cell.row).length);
for(const map of data.maps){
 const raw=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/'+map.source.file,'utf8'));
 // 特殊地块的数值都写在原地块黑板上（PRTS 战场一览与之逐项一致）：
 //   tile_infection＝活性源石（#04）：5 分钟内每秒 70 真实伤害、攻击力 +20%、攻击速度 +20。
 const infectionTile=(raw.mapData?.tiles||[]).find(t=>t.tileKey==='tile_infection'&&t.blackboard?.length);
 if(infectionTile){
  const bb=Object.fromEntries(infectionTile.blackboard.map(r=>[r.key,r.valueStr??r.value]));
  map.environment??={};
  map.environment.originium={damage:Number(bb.damage)||0,atk:Number(bb.atk)||0,attackSpeed:Number(bb.attack_speed)||0,duration:Number(bb.duration)||0,source:map.source.file};
 }
 for(const controller of raw.predefines?.tokenInsts||[]){
  const id=controller.inst.characterKey;
  if(id==='trap_270_spawnp'&&!controller.hidden){
   const skill=structuredClone(skillTable.sktok_spawnp.levels[(controller.mainSkillLvl||1)-1]),bb=Object.fromEntries([...skill.blackboard,...(controller.overrideSkillBlackboard||[])].map(r=>[r.key,r.valueStr??r.value]));
   const action=raw.branches?.[bb['talent@branch_id']]?.phases?.[0]?.actions?.[Number(bb['talent@action_index'])],route=raw.routes?.[action?.routeIndex];
   if(action?.actionType!=='SPAWN'||action.key!=='enemy_3010_mcreep'||!route)throw Error('矿道缺少明确的矿工生成路线 '+map.source.file);
   skill.blackboard=Object.entries(bb).map(([key,value])=>typeof value==='string'?{key,valueStr:value,value:0}:{key,value,valueStr:null});
   (map.mineCamps??=[]).push({x:controller.position.col-map.origin.col,y:map.origin.row-controller.position.row,route,skill});
   continue;
  }
  if(controller.hidden||!(id==='trap_042_tidectrl'&&controller.skillIndex===2||id==='trap_036_storm'||id==='trap_098_mire'||id==='trap_013_blower'))continue;
  const skillId=characterTable[id].skills[controller.skillIndex].skillId;
  const skill=skillTable[skillId].levels[controller.mainSkillLvl-1];
  const bb=Object.fromEntries([...skill.blackboard,...(controller.overrideSkillBlackboard||[])].map(x=>[x.key,x.value]));
  map.environment??={};
  if(id==='trap_042_tidectrl')map.environment.deepWater={skillId,level:controller.mainSkillLvl,damage:bb['sea_drown[enemy].damage'],moveScale:bb['sea_drown[enemy].move_speed'],attackSpeedScale:1+bb['sea_drown[enemy].attack_speed'],source:map.source.file};
  else if(id==='trap_036_storm')map.environment.sandStorm={skillId,level:controller.mainSkillLvl,direction:controller.direction,damage:bb.damage,interval:bb.interval,attackRatio:bb.atk,moveScale:1+bb['sand_storm[enemy].move_speed'],respawnMultiplier:bb.respawn_time,duration:bb.duration,source:map.source.file};
  // 沼泽控制（#06）：位于<沼泽地段>的单位每 value 秒叠一层，攻速/移速各 -5%，至多 max_stack_cnt 层。
  else if(id==='trap_098_mire')map.environment.mire={skillId,level:controller.mainSkillLvl,attackSpeed:bb.attack_speed,moveSpeed:bb.move_speed,maxStack:bb.max_stack_cnt,interval:bb.value,source:map.source.file};
  // 源石流发生装置（#05）：气流只影响装置正前方 BLOWER_LENGTH 格（位置取地图 devices）。
  else map.environment.blower={skillId,level:controller.mainSkillLvl,equal:bb['blower_s_character[equal].atk'],vertical:bb['blower_s_character[vertical].atk'],opposite:bb['blower_s_character[opposite].atk'],equalMove:bb['blower_s_enemy[equal].move_speed'],oppositeMove:bb['blower_s_enemy[opposite].move_speed'],length:BLOWER_LENGTH,source:map.source.file};
 }
}
await fs.writeFile('dist/runtime-data.js','// Generated historical mode runtime data.\nexport const NATIVE_DATA = '+JSON.stringify(data)+';\n');console.log('Native runtime: '+Object.keys(profiles).length+' cultivation states, '+Object.keys(levels).length+' levels');
