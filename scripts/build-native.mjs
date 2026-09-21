import fs from 'node:fs/promises';
import {resolveChess,applyEnemyOverrides,richText} from '../dist/protocol.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
const source=JSON.parse(await fs.readFile('data/modes/alliance-lower/source.json','utf8')),base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8')),catalog=JSON.parse(await fs.readFile('data/modes/alliance-lower/catalog.json','utf8')),behaviorConfig=JSON.parse(await fs.readFile('data/modes/alliance-lower/enemy-behavior-overrides.json','utf8')),behaviorOverrides=behaviorConfig.overrides||{},manifest=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/manifest.json','utf8')),characterTable=JSON.parse(await fs.readFile('data/gamedata/allianceLower/character_table.json','utf8')),enemyHandbook=JSON.parse(await fs.readFile('data/gamedata/allianceLower/enemy_handbook_table.json','utf8'));
const enemyCostEffects={};for(const [id,entry] of Object.entries(enemyHandbook.enemyData||{})){if(id==='enemy_2008_flking')continue;/* PRTS：墓碑图鉴中的全场削弱属于原关卡，不能烘成敌人天赋。 */const text=(entry.abilityList||[]).map(x=>x.text||'').join(' '),effects=[];if(/部署费用回复速度减半/.test(text))effects.push({costRecoveryMultiplier:.5});if(/再部署时间加倍/.test(text))effects.push({respawnTimeMultiplier:2});if(/封锁我方部署费用的自然回复/.test(text))effects.push({costRecoveryMultiplier:0});if(effects.length)enemyCostEffects[id]=effects;}
const virtualChess=[['chess_virtual_prepared_medic','char_605_cmedic',4,0],['chess_virtual_touch','char_613_acmedc',6,2]];for(const[chessId,charId,chessLevel,defaultSkillIndex]of virtualChess){const template=source.season.charChessDataDict[Object.keys(source.season.charChessDataDict).find(id=>source.season.charChessDataDict[id].isGolden===false)];source.season.charChessDataDict[chessId]={...structuredClone(template),chessId,isGolden:false,charId,bondIds:[],garrisonIds:[],status:{...template.status,evolvePhase:'PHASE_2',charLevel:1,skillLevel:1,equipLevel:0}};source.season.charShopChessDatas[chessId]={chessId,goldenChessId:null,chessLevel,shopLevelSortId:999,chessType:'NORMAL',charId,tmplId:null,defaultSkillIndex,isHidden:true};}
const profiles={};for(const shop of Object.values(source.season.charShopChessDatas)){if(!shop.charId)continue;const entity=base.entities[shop.tmplId||shop.charId],rawCharacter=characterTable[shop.tmplId||shop.charId]||{};for(const id of [shop.chessId,shop.goldenChessId]){if(!id)continue;const states=[];for(let i=0;i<entity.skillRefs.length;i++)states.push(resolveChess(source,base,id,{skillIndex:i}));const selected=resolveChess(source,base,id);profiles[id]={...selected,profession:entity.profession,branch:entity.branch,position:entity.position,groupId:rawCharacter.groupId??null,teamId:rawCharacter.teamId??null,skillChoices:states,asset:catalog.roster.find(r=>r.charId===shop.charId)?.asset};}}
const catalogById=Object.fromEntries(catalog.enemies.map(e=>[e.id,e]));
// 敌人档案统一入口：把行为覆盖 JSON 和 enemyBehaviorProfile 推导出的能力（持续伤害区域、
// 流血、抵抗等）一起写进 enemyBehavior。客户端读到的 runtime-data 因此自带这些字段，
// 不会因为快照丢失原始 skills 表而退化成空行为。
const buildEnemyProfile=(id,rawData,catalogEnemy,extra={})=>{const profile={...rawData,ability:catalogEnemy?.ability||base.enemies[id]?.codex?.abilityList||[],kinds:catalogEnemy?.kinds||[],categories:catalogEnemy?.categories||[],costEffects:enemyCostEffects[id]||[],...extra,enemyBehavior:behaviorOverrides[id]};return {...profile,enemyBehavior:enemyBehaviorProfile(profile)};};
const levels={};for(const[id,entry]of Object.entries(manifest.files)){const l=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/'+entry.file,'utf8'));const enemyProfiles={};for(const ref of l.enemyDbRefs||[]){const raw=base.enemies[ref.id]?.levels.find(x=>x.level===ref.level),catalogEnemy=catalogById[ref.id];if(raw)enemyProfiles[ref.id]=buildEnemyProfile(ref.id,applyEnemyOverrides(raw.data,ref.overwrittenData),catalogEnemy);}levels[id]={routes:l.routes,waves:l.waves,enemyProfiles};}
const assets=JSON.parse(await fs.readFile('dist/assets/prts/manifest.json','utf8'));const branchRules=JSON.parse(await fs.readFile('data/prts/branch-rules.json','utf8'));const data={...source,tokens:Object.fromEntries(Object.entries(base.entities).filter(([id])=>id.startsWith('token_'))),branchRules,profiles,ranges:base.ranges,maps:catalog.maps,enemies:Object.fromEntries(catalog.enemies.map(e=>[e.id,buildEnemyProfile(e.id,e.data,e)])) ,items:catalog.items,assets:Object.fromEntries(Object.entries(assets.assets).map(([id,a])=>[id,a.file])),levels,enemyIndex:catalog.enemies.map(e=>{const a=e.data?.attributes||{},profile=buildEnemyProfile(e.id,e.data,e);return {id:e.id,name:e.name,kinds:profile.kinds||[],categories:profile.categories||[],motion:e.data?.motion||'WALK',applyWay:e.data?.applyWay||'',hp:a.maxHp??0,atk:a.atk??0,def:a.def??0,res:a.magicResistance??0,speed:a.moveSpeed??0,interval:a.baseAttackTime??0,tags:e.data?.enemyTags||[],desc:richText(e.data?.description||'')+(profile.enemyBehavior.scopeNote?' '+profile.enemyBehavior.scopeNote:''),enemyBehavior:profile.enemyBehavior};}),limitations:['商店刷新先按当前等级掷出阶级（最高阶30%、次高阶40%、更低阶合计30%），再从该阶级的剩余库存里抽；掷中的阶级没有库存时回落到整池随机抽。','技能通用属性、技力与弹药已接入；特殊召唤、形态、动画释放帧和部分敌人能力仍存在差异。','部分复杂策略、地图环境和装备联动尚未完整实现，请通过反馈入口记录。','道中敌人改为开局随机三种特训词条；每档按难度预算从自建敌人池抽取。空池使用占位模板。生命／攻击倍率按PRTS用户表接入，页面声明不保证准确。'],version:'manual-2026-09-13'};
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
for(const map of data.maps){
 const raw=JSON.parse(await fs.readFile('data/modes/alliance-lower/levels/'+map.source.file,'utf8'));
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
  if(controller.hidden||!(id==='trap_042_tidectrl'&&controller.skillIndex===2||id==='trap_036_storm'))continue;
  const skillId=characterTable[id].skills[controller.skillIndex].skillId;
  const skill=skillTable[skillId].levels[controller.mainSkillLvl-1];
  const bb=Object.fromEntries([...skill.blackboard,...(controller.overrideSkillBlackboard||[])].map(x=>[x.key,x.value]));
  map.environment??={};
  if(id==='trap_042_tidectrl')map.environment.deepWater={skillId,level:controller.mainSkillLvl,damage:bb['sea_drown[enemy].damage'],moveScale:bb['sea_drown[enemy].move_speed'],attackSpeedScale:1+bb['sea_drown[enemy].attack_speed'],source:map.source.file};
  else map.environment.sandStorm={skillId,level:controller.mainSkillLvl,direction:controller.direction,damage:bb.damage,interval:bb.interval,attackRatio:bb.atk,moveScale:1+bb['sand_storm[enemy].move_speed'],respawnMultiplier:bb.respawn_time,duration:bb.duration,source:map.source.file};
 }
}
await fs.writeFile('dist/runtime-data.js','// Generated historical mode runtime data.\nexport const NATIVE_DATA = '+JSON.stringify(data)+';\n');console.log('Native runtime: '+Object.keys(profiles).length+' cultivation states, '+Object.keys(levels).length+' levels');
