// 商店库存：每个商店可售干员在本局内有限个。只统计「从商店买走」的份数；
// 干员／策略等特殊效果获得的干员不计入库存，出售也不回补（它们没有 purchases 记录）。
export const STOCK_BY_TIER={1:64,2:64,3:64,4:32,5:16,6:8};
export function initialStock(data,chessId){const tier=Number(data.season.charShopChessDatas[chessId]?.chessLevel)||1;return STOCK_BY_TIER[tier]??STOCK_BY_TIER[1];}
// 把关卡数据里的可售干员一次性铺满库存表，缺项按阶级补默认值（老存档或新增干员都能自愈）
export function ensureStock(data,s){
 const rows=Object.values(data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);
 s.stock??={};
 for(const row of rows){const id=row.chessId;const init=initialStock(data,id);const cur=s.stock[id];if(!Number.isFinite(cur)||cur<0)s.stock[id]=init;}
 return s.stock;
}
export function stockOf(data,s,chessId){ensureStock(data,s);return Number.isFinite(s.stock?.[chessId])?s.stock[chessId]:initialStock(data,chessId);}
// 购买记录用 map 计数，卖出时按记录回补；三合一合并时把各份记录累加，所以卖出精锐恢复的是合成时买走的全部份数
function addPurchases(into,from){if(!from)return into;for(const [id,n] of Object.entries(from))into[id]=(into[id]||0)+Number(n||0);return into;}
export function restoreStock(s,unit){const owned=unit?.purchases;if(!owned)return;s.stock??={};for(const [id,n] of Object.entries(owned)){if(s.stock[id]===undefined)continue;s.stock[id]+=Number(n||0);}}
// 技能范围几何：范围形状是权威数据（data.ranges[rangeId].grids），特效据此贴合真实形状，
// 不靠像素半径估算。spanX/spanY 是相对施法者的最大横/纵跨度，cells 是原始格子。
const RANGE_GEOMETRY=new Map();
export function rangeGeometry(data,rangeId){
 if(!rangeId)return null;
 const key=rangeId;
 if(RANGE_GEOMETRY.has(key))return RANGE_GEOMETRY.get(key);
 const grids=data?.ranges?.[rangeId]?.grids;
 if(!grids?.length){RANGE_GEOMETRY.set(key,null);return null;}
 const cols=grids.map(g=>Number(g.col)||0),rows=grids.map(g=>Number(g.row)||0);
 const geometry={rangeId,cells:grids.map(g=>({col:Number(g.col)||0,row:Number(g.row)||0})),count:grids.length,
  spanX:Math.max(...cols)-Math.min(...cols),spanY:Math.max(...rows)-Math.min(...rows),
  reachX:Math.max(...cols.map(Math.abs)),reachY:Math.max(...rows.map(Math.abs))};
 RANGE_GEOMETRY.set(key,geometry);
 return geometry;
}
// 技能是否比常态范围更大（真银斩这类"范围扩大"技能）。用于攻击特效的 wide 标记。
export function skillWidensRange(profile,skillIndex=null){
 const skill=skillIndex!=null?(profile?.skillChoices?.[skillIndex]?.skill??profile?.skill):profile?.skill;
 if(!skill?.rangeId||!profile?.rangeId)return false;
 return skill.rangeId!==profile.rangeId;
}
export function baseFunding(round){if(!Number.isInteger(round)||round<1)throw Error('Invalid round');return round+3;}
// 唯一的朝向表：0=右、1=下、2=左、3=上（与 `session.js` 的 aim、native-play 的「→↓←↑」一致）。
// 范围旋转（`rangeWithSkill` 的 `[x,y]=[-y,x]`）、推拉 forward、技能落点方向都读这一份，
// 不要再各写一张（历史上出现过 1/3 颠倒的镜像表，上下朝向会打到反方向）。
export const DIRECTIONS=Object.freeze([[1,0],[0,1],[-1,0],[0,-1]]);
export function directionOf(dir){return DIRECTIONS[((Number(dir)||0)%4+4)%4];}
// Versioned native data helpers. No missing rule is guessed or silently simulated.
export function blackboard(entries=[]){return Object.fromEntries((entries||[]).map(e=>[e.key,e.valueStr??e.value]));}
// 棋盘上该画「上一场战斗的单位」还是「备战期的我方单位」：战斗、结算与休整期都沿用战斗棋盘，
// 只有真正的备战期（prep）画整备区的布置——否则上一场的召唤物会在备战时留在场上。
export function battleBoardVisible(phase){return phase==='battle'||phase==='finished'||phase==='intermission';}
// 隔离平台＝被围栏围住的**地面**（`tile_fence_bound` 的低地可部署格）：地面敌人路线不经过它
// （原表 passableMask 是 FLY_ONLY），但它是低地、不是高台。表现层据此画「地面＋围栏」，
// 并且不能像高台那样抬升——抬起来就会和真正的高台长得一模一样（用户 2026-09-19 报的问题）。
export function isolatedPlatform(tile){return !!tile&&tile.tileKey==='tile_fence_bound'&&tile.heightType!=='HIGHLAND'&&tile.buildableType!=='NONE';}
// ── 再生形态（Revive）的画法 ──────────────────────────────────────────────
// 原表只有 `Revive[Trigger].prop_max_hp` / `interval`，形态名只写在图鉴文案里；游戏与 PRTS
// 都没有形态的独立立绘（`<敌人页>/spine` 只有一个 asset，模型图集里也没有余烬／傀儡专用图块，
// 原作用的是同一套模型换动作）。所以形态视觉只能由「本体头像 + 形态专属缩放 + 色调」表达，
// 具体数值登记在 `enemy-behavior-overrides.json` 的 `revive.sprite`，**不从 hitCountHp 推**：
// `hitCountHp` 是运行时状态（碎片、余烬、再生形态都会置真），拿它当缩放依据会让碎片以外的敌人也缩水。
export const FORM_SPRITE_TINTS=['ember','puppet'];
export function enemySprite(enemy){
 const base={key:enemy?.id||null,scale:Number(enemy?.spriteScale)||1,tint:null};
 if(!enemy||enemy.revivePhase!=='form')return base;
 const sprite=enemy.revive?.sprite;
 if(!sprite)return base;
 const scale=Number(sprite.scale);
 return {key:sprite.avatar||base.key,scale:Number.isFinite(scale)&&scale>0?scale:base.scale,tint:sprite.tint||null};
}
// ── 战斗顶栏（回合 / 击杀·剩余敌人 / 剩余生命）────────────────────────────
// 击杀数**不含衍生敌人**：解压缩碎片、敌方召唤／分裂／幻影这些战斗中途生成的敌人不是本波编制，
// 单独记在 `s.derivedKills` 里（`s.kills` 保持原语义，战报记录与卫戍击倒计数都不受影响）。
// 剩余敌人＝还没处理掉的：队列里未入场 ＋ 已排定但还没落地 ＋ 场上存活（漏怪算已处理）。
export function battleTally(s){
 const kills=Math.max(0,(Number(s?.kills)||0)-(Number(s?.derivedKills)||0));
 const alive=(s?.enemies||[]).filter(e=>e.hp>0).length;
 const pending=(s?.queue||[]).length+(s?.pendingEnemySpawns||[]).length;
 return {kills,alive,pending,remaining:alive+pending,total:Number(s?.total)||0};
}
// 地块的抬升高度：只有**可部署的高台**才抬起（隔离平台是地面，永远不抬）。
export function tileLiftAmount(tile,tileHeight){return tile?.heightType==='HIGHLAND'&&tile.buildableType!=='NONE'?Math.min(10,(tileHeight||0)*.22):0;}
// ── 盟约面板的「当前动态数值」 ─────────────────────────────────────────────
// 原表用 descParamBaseList / descParamPerStackList 声明哪些数值受层数影响（描述里只写「受层数影响」）。
// 这里逐项算出当前值，**原表声明了几项就渲染几项**，不再靠手写 switch（叙拉古的持续时间、
// 谢拉格寒风时长这类都曾被漏掉）。标签按参数键给，歧义的用 BOND_PARAM_LABEL_OVERRIDE 逐盟约覆盖。
const BOND_PARAM_META={
 base_atk:{label:'攻击力提升',kind:'pctAdd'},
 base_time:{label:'增益持续时间',kind:'seconds'},
 base_damage_scale:{label:'伤害倍率',kind:'pctMult'},
 base_ex_damage_scale:{label:'对寒冷、冻结目标的伤害倍率',kind:'pctMult'},
 'bond_eff_kjerag[storm].base_time':{label:'寒风施加寒冷的持续时间',kind:'seconds'},
 base_ammo_percent:{label:'技能额外弹药比例',kind:'pctAdd'},
 base_max_hp:{label:'最大生命值提升',kind:'pctAdd'},
 base_attack_speed:{label:'攻击速度加成',kind:'flatAdd'},
 base_duration:{label:'攻速与隐匿状态的持续时间',kind:'seconds'},
 base_damage:{label:'隐匿期间的真实伤害',kind:'flat'},
 base_max_atk_when_born:{label:'部署攻击增益上限',kind:'pctAdd'},
 base_prob:{label:'触发概率',kind:'pctAdd'},
 base_damage_scale_show:{label:'法术脆弱',kind:'pctAdd'},
 base_damage_scale_show_ex:{label:'生命低于50%时的法术脆弱',kind:'pctAdd'},
 base_damage_value:{label:'反击法术伤害',kind:'flat'},
 base_def:{label:'防御力提升',kind:'pctAdd'},
 baseprob:{label:'下次刷新免费概率',kind:'pctAdd'}
};
const BOND_PARAM_LABEL_OVERRIDE={
 sargonShip:{base_time:{label:'攻速与攻击力增益的持续时间'}},
 skillfulShip:{base_attack_speed:{label:'邻近干员的攻击速度加成'}},
 swiftShip:{base_prob:{label:'技能结束时回复技力的概率'}},
 indomShip:{base_prob:{label:'近战干员被击倒后保留部署的概率'}}
};
const bondRound=v=>Math.round(v*1000)/1000;
const bondPct=v=>`${bondRound(v*100)}%`;
const formatBondValue=(v,kind)=>kind==='pctMult'?`提升至 ${bondPct(v)}`:kind==='pctAdd'?`+${bondPct(v)}`:kind==='seconds'?`${bondRound(v)} 秒`:kind==='flatAdd'?`+${bondRound(v)}`:`${bondRound(v)}`;
function bondEffectValues(data,bondId){
 const info=data.season.bondInfoDict?.[bondId],values={};
 for(const row of (data.season.effectBuffInfoDataDict?.[info?.effectId]||[]).flatMap(e=>e.blackboard||[]))if(row.key!=='key'&&values[row.key]===undefined)values[row.key]=Number(row.valueStr??row.value);
 return {info,values};
}
export function bondScaledParams(data,bondId,layers){
 const {info,values}=bondEffectValues(data,bondId);if(!info)return[];
 const level=Math.max(0,Number(layers)||0),base=info.descParamBaseList||[],per=info.descParamPerStackList||[],out=[];
 for(let i=0;i<Math.max(base.length,per.length);i++){
  const baseKey=base[i];if(!baseKey)continue;
  const baseValue=Number(values[baseKey]),perValue=per[i]!=null?Number(values[per[i]])||0:0;
  if(!Number.isFinite(baseValue))continue;
  const override=(BOND_PARAM_LABEL_OVERRIDE[bondId]||{})[baseKey];
  const meta={...(BOND_PARAM_META[baseKey]||{label:baseKey,kind:'flat'}),...(override||{})};
  out.push({key:baseKey,label:meta.label,text:formatBondValue(baseValue+perValue*level,meta.kind),formula:`${bondRound(baseValue)} + ${bondRound(perValue)} × ${level}层`});
 }
 return out;
}
// 面板 HTML：受层数影响的数值 + 少量「阈值／累计」类备注（不含层数参数本身）。
export function bondCurrentPreviewHtml(data,bondId,layers){
 const {info,values}=bondEffectValues(data,bondId);if(!info)return '';
 const level=Math.max(0,Number(layers)||0),line=(label,value)=>`<li><span>${label}</span><b>${value}</b></li>`,lines=[];
 for(const param of bondScaledParams(data,bondId,level))lines.push(line(param.label,`${param.text}<small>${param.formula}</small>`));
 const layer=Number(values.layer)||0,count=Number(values.count)||0;
 if(bondId==='visiShip'&&layer)lines.push(line('已达到的资金奖励',`${Math.floor(level/layer)*count}资金（每${layer}层+${count}）`));
 if(bondId==='miraShip'&&layer)lines.push(line('已达到的层数资金奖励',`${Math.floor(level/layer)*count}资金`));
 if(bondId==='investShip')lines.push(line('「获得时」类特质的触发次数',`${level>=100?3:2}次（${level>=100?'已达到':'100层后达到'}）`));
 if(bondId==='skillfulShip'&&Number(values.power_bond_stack_cnt))lines.push(line('扩大范围阈值',`${values.power_bond_stack_cnt}层`));
 if(bondId==='raidShip'&&Number(values.power_bond_stack_cnt))lines.push(line('闲置强化状态',level>=values.power_bond_stack_cnt?`攻击速度 +${values.power_attack_speed}，攻击/生命提升已生效`:`未激活（需${values.power_bond_stack_cnt}层）`));
 return lines.length?`<section class="native-bond-current"><h3>当前动态数值 · ${level}层</h3><ul>${lines.join('')}</ul></section>`:'';
}
// 富文本 → 显示文本。原表用尖括号区分两类东西：
//   样式标签：`<@ba.vup>`、`<$ba.stun>`、`<@autochess.gray>`、闭合的 `</>` —— 丢掉；
//   内容：道具/召唤物/盟约/敌人/时机名（`<铜灯盘>`、`<替身>`、`<寻呼模块>`、`<炎>`、`<获得时>`）——
//   里面的文字是正文，必须保留。
// 原表还会嵌套（`<在场<@autochess.dgreen>6</>名不同【炎】干员>`），所以按尖括号配对扫描，不能简单用正则。
export function richText(value){
 const raw=String(value??'');let out='',i=0;
 while(i<raw.length){
  const lt=raw.indexOf('<',i);
  if(lt<0){out+=raw.slice(i);break;}
  out+=raw.slice(i,lt);
  let depth=0,end=-1;
  for(let j=lt;j<raw.length;j++){
   if(raw[j]==='<')depth++;
   else if(raw[j]==='>'){depth--;if(depth===0){end=j;break;}}
  }
  if(end<0){out+=raw.slice(lt);break;}                     // 未闭合：原样留着
  const inner=raw.slice(lt+1,end);
  if(!/^[@$/]/.test(inner)&&inner!=='')out+=richText(inner); // 内容型：保留内部文字
  i=end+1;
 }
 return out.replace(/\\n/g,'\n');
}
// 卫戍效果（干员特质）的显示文本。原表把触发时机写成尖括号标签（`<获得时>`／`<战斗中>`…），
// 直接按富文本去标签会把时机一起吃掉，所以这里统一成【…】前缀；没有标签的按 eventType／能力键补。
// 时机口径见 GARRISON_EFFECT_AUDIT.md §一。
export const GARRISON_TIMING_LABELS={SERVER_GAIN:'获得时',SERVER_PREP_START:'进入休整期时',SERVER_PREP_FIN:'休整期结束时',SERVER_REFRESH_SHOP:'刷新时',SERVER_CHESS_SOLD:'售出时',SERVER_PRICE:'购买时',IN_BATTLE:'战斗中'};
const GARRISON_TIMING_TAG=/<([^@/][^>]*)>/g,GARRISON_TIMING_TEXT=/时$|战斗中|部署/;
export function garrisonTimingLabel(rule){
 const raw=String(rule?.garrisonDesc||rule?.description||'');
 const tag=[...raw.matchAll(GARRISON_TIMING_TAG)].map(m=>m[1]).find(t=>GARRISON_TIMING_TEXT.test(t));
 if(tag)return tag;
 const key=String(blackboard(rule?.blackboard||[]).key||'');
 if(/onstart/.test(key))return '部署时';
 if(String(rule?.battleRuneKey||'').startsWith('give_garrison'))return '战斗开始时';
 return GARRISON_TIMING_LABELS[rule?.eventType]||'';
}
export function garrisonText(rule){
 const when=garrisonTimingLabel(rule);
 // 先把时机标签摘掉（它会变成前面的【…】前缀），再按富文本规则处理剩下的内容标签。
 const raw=String(rule?.garrisonDesc||rule?.description||'').replace(new RegExp(GARRISON_TIMING_TAG.source,'g'),m=>GARRISON_TIMING_TEXT.test(m.slice(1,-1))?'':m);
 const body=richText(raw).trim();
 return when?`【${when}】${body}`:body;
}
export function talentCandidateOpen(candidate,status,potentialRank=0){
 const phase=Number(String(status?.evolvePhase||'PHASE_0').replace('PHASE_','')),need=Number(String(candidate.unlockCondition?.phase||'PHASE_0').replace('PHASE_',''));
 const level=status?.charLevel??1;
 if(need>phase||(need===phase&&(candidate.unlockCondition?.level||1)>level))return false;
 return (candidate.requiredPotentialRank||0)<=potentialRank;
}
export function resolveActiveTalents(entity,status,{potentialRank=0,modulePhase=null}={}){
 const slots=[];
 for(const [index,slot] of (entity?.talents||[]).entries()){
  const pick=(slot.candidates||[]).filter(c=>talentCandidateOpen(c,status,potentialRank)).at(-1);
  if(pick)slots.push({slot:index,name:pick.name,description:pick.description,blackboard:pick.blackboard||[],prefabKey:pick.prefabKey||null});
 }
 for(const part of modulePhase?.parts||[]){
  if(part.isToken)continue;
  const cands=part.addOrOverrideTalentDataBundle?.candidates;
  if(!cands?.length)continue;
  const pick=cands.filter(c=>talentCandidateOpen(c,status,potentialRank)).at(-1);
  if(!pick)continue;
  const row={slot:slots.length,name:pick.name,description:pick.description||pick.upgradeDescription,blackboard:pick.blackboard||[],prefabKey:pick.prefabKey||null,fromModule:true};
  const i=Number.isInteger(pick.talentIndex)&&pick.talentIndex>=0?slots.findIndex(s=>s.slot===pick.talentIndex):slots.findIndex(s=>pick.name&&s.name===pick.name);
  if(i>=0){const previous=slots[i];row.slot=previous.slot;row.name??=previous.name;row.description??=previous.description;const merged={...blackboard(previous.blackboard),...blackboard(row.blackboard)};row.blackboard=Object.entries(merged).map(([key,value])=>({key,value}));slots[i]=row;}else slots.push(row);
 }
 return slots;
}
export function nativeAttributes(entity,status){
 const phaseIndex=Math.min(entity.phases.length-1,Number(status.evolvePhase.replace('PHASE_',''))),phase=entity.phases[phaseIndex];const level=Math.max(1,Math.min(status.charLevel,phase.maxLevel));const frames=phase.attributesKeyFrames;
 let left=frames[0],right=frames.at(-1);for(let i=1;i<frames.length;i++)if(level<=frames[i].level){left=frames[i-1];right=frames[i];break;}
 const t=right.level===left.level?0:(level-left.level)/(right.level-left.level),data={};for(const[k,v]of Object.entries(left.data)){const other=right.data[k];data[k]=typeof v==='number'&&typeof other==='number'?v+(other-v)*t:v;if(['maxHp','atk','def'].includes(k))data[k]=Math.round(data[k]);}return {phase:phaseIndex,level,rangeId:phase.rangeId,attributes:data};
}
export function resolveChess(data,base,chessId,{skillIndex,ownedBonus=null,potentialRank=0}={}){
 const chess=data.season.charChessDataDict[chessId];if(!chess)throw Error('Unknown chess '+chessId);
 const normalId=chess.isGolden?data.season.chessNormalIdLookupDict[chessId]||Object.keys(data.season.charChessDataDict).find(id=>data.season.charChessDataDict[id].upgradeChessId===chessId):chessId;
 const shop=data.season.charShopChessDatas[normalId];if(!shop?.charId)throw Error('DIY slot must be assigned before resolution');const entity=base.entities[shop.tmplId||shop.charId];if(!entity)throw Error('Missing native entity '+shop.charId);
 const state=nativeAttributes(entity,chess.status);const index=skillIndex??shop.defaultSkillIndex,ref=entity.skillRefs[index];const skill=ref?base.skills[ref.skillId]?.levels[Math.min(chess.status.skillLevel-1,base.skills[ref.skillId].levels.length-1)]:null;
 const module=base.modules[shop.defaultUniEquipId],modulePhase=chess.status.equipLevel>0?module?.phases.find(p=>p.equipLevel===chess.status.equipLevel):null;
 const attributes={...state.attributes},moduleStats=blackboard(modulePhase?.attributeBlackboard);for(const[from,to]of Object.entries({max_hp:'maxHp',atk:'atk',def:'def',magic_resistance:'magicResistance',attack_speed:'attackSpeed',respawn_time:'respawnTime',cost:'cost',block_cnt:'blockCnt'}))attributes[to]+=(moduleStats[from]||0);
 // Only native additive potential modifiers are handled here; other effects stay in their descriptors.
 for(const p of (entity.potentials||[]).slice(0,potentialRank))for(const m of p.buff?.attributes?.attributeModifiers||[]){const key={MAX_HP:'maxHp',ATK:'atk',DEF:'def',MAGIC_RESISTANCE:'magicResistance',COST:'cost',RESPAWN_TIME:'respawnTime'}[m.attributeType];if(key&&m.formulaItem==='ADDITION')attributes[key]+=m.value;}
 if(ownedBonus)for(const[k,v]of Object.entries(ownedBonus))if(['maxHp','atk','def'].includes(k))attributes[k]*=1+v;
 return {chessId,normalId,charId:shop.charId,name:entity.name,rank:shop.chessLevel,isGolden:chess.isGolden,status:chess.status,...state,attributes,range:base.ranges[state.rangeId],skillId:ref?.skillId||null,skillIndex:index,skill,moduleId:modulePhase?shop.defaultUniEquipId:null,modulePhase,bonds:chess.bondIds,garrisons:chess.garrisonIds.map(id=>({id,...data.season.garrisonDataDict[id]})),talents:entity.talents,activeTalents:resolveActiveTalents(entity,chess.status,{potentialRank,modulePhase}),trait:entity.trait,sourceCommit:data.source.commit};
}
export function skillPolicy(common,entity,skillIndex){const matches=common.skillTriggerDataList.filter(p=>(p.charId? p.charId===entity.id&&p.skillIndex===skillIndex:p.subProfessionId?p.subProfessionId===entity.branch:p.profession===entity.profession));return matches.find(p=>p.charId)||matches.find(p=>p.subProfessionId)||matches[0]||{skillTriggerType:'DEFAULT'};}
export function shouldAutoSkill({policy,ready,deployed,now,lastOperation=0,initialDeployment=0,hasTarget=false,hasEnemyInSkillRange=false,hasEnemyInInitialRange=false,hasAnyTarget=false,wasDamaged=false,toggleUsed=false,isToggle=false}){
 if(!ready||!deployed||now-Math.max(lastOperation,initialDeployment)<3)return false;if(isToggle&&toggleUsed)return false;
 switch(policy){case 'ALWAYS':return true;case 'TAKE_DAMAGE':return wasDamaged;case 'SEARCH':return hasEnemyInInitialRange;case 'GDGLOW_SKILL_2':return hasAnyTarget;case 'CUSTOM_RANGE_SEARCH_ENEMY':return hasEnemyInSkillRange;case 'DEFAULT':return hasTarget;default:return false;}
}
export function buildPhasePlan(data,modeId){const turns=data.common.turnInfoDataDict[modeId],battles=data.season.battleDataDict[modeId];if(!turns||!battles)throw Error('Unknown mode');return Object.values(turns).sort((a,b)=>a.round-b.round).map(t=>({...t,battles:battles[t.round]||[],isConditional:t.round===15&&data.season.modeDataDict[modeId].modeDifficulty!=='TRAINING'}));}
export function shopTerms(data,modeId,level,discount=0){const s=data.season.shopLevelDataDict[modeId]?.[level];if(!s)throw Error('Unknown shop level');return {operatorSlots:s.charChessCount,itemSlots:s.itemCount,upgradeCost:level>=6?null:Math.max(0,s.initialUpgradePrice-discount),refreshCost:data.season.constData.shopRefreshPrice};}
export function purchasePrice(data,chessId){const shop=data.season.charShopChessDatas[chessId];if(shop)return data.season.shopCharChessInfoData[shop.chessLevel][0].purchasePrice;const item=data.season.trapChessDataDict[chessId];if(item)return item.purchasePrice;throw Error('Unknown offer '+chessId);}
export function activeBonds(data,units,modeId=null){
 const allowed=modeId?new Set(data.season.modeDataDict[modeId].activeBondIdList):null,rows={};
 for(const[id,b]of Object.entries(data.season.bondInfoDict)){
  const eligible=units.filter(u=>u.position!=null||b.activeCondition==='BOARD_AND_DECK');
  const golden=b.activeConditionTemplate==='count_threshold_upward_golden';
  const members=golden?eligible.filter(u=>data.season.charChessDataDict[u.chessId]?.isGolden):eligible.filter(u=>(u.bondIds||data.season.charChessDataDict[u.chessId]?.bondIds||[]).includes(id));
  const count=golden?members.length:new Set(members.map(u=>u.charId)).size;
  const threshold=Number(b.activeParamList[0]),active=b.activeConditionTemplate==='count_threshold_downward'?count>=threshold&&count<Number(b.activeParamList[1]):count>=threshold;
  rows[id]={count,rawCount:count,active:(!allowed||allowed.has(id))&&active};
 }
 if(rows.maniShip?.active)for(const[id,row]of Object.entries(rows))if(data.common.bondInfoDict[id]?.isPower&&row.rawCount>0){row.count++;row.active=(!allowed||allowed.has(id))&&row.count>=Number(data.season.bondInfoDict[id].activeParamList[0]);}
 return rows;
}
export function applyEnemyOverrides(base,override){
 if(override&&typeof override==='object'&&!Array.isArray(override)&&Object.hasOwn(override,'m_defined'))return override.m_defined?structuredClone(override.m_value):structuredClone(base??null);
 if(override===null||override===undefined)return structuredClone(base??null);
 if(Array.isArray(override)||typeof override!=='object')return structuredClone(override);
 const out={...structuredClone(base||{})};for(const[k,v]of Object.entries(override))out[k]=applyEnemyOverrides(base?.[k],v);return out;
}
// 整备区（手牌）上限：干员、装备、召唤物卡一律占格。干员／策略效果发放的卡牌允许
// 临时超出（handLength>HAND_LIMIT），但超出期间不允许再购入干员和装备，必须先清出空余。
export const HAND_LIMIT=10;
// 每回合漏怪掉血上限（用户 2026-09-19 口径）：不管这一回合漏了多少敌人，生命最多扣 10 点。
// 只影响扣血；漏失真值照旧记进战报与 `s.lastBattle.leaks`。判负也用上限后的值，
// 所以「上限救得回来」的回合不会因为漏失数超过当前生命就提前结束。
export const ROUND_LEAK_CAP=10;
// 海猫模式（mode_cat_all）的无限资金哨兵值。资金本身只有「入账／出账／回合重置」三类写入，
// 全部走 Session.setFunds／addFunds：只要 s.cat 为真，写多少都收敛回这个值。
// 早先只在开局赋一次 MAX_SAFE_INTEGER，于是 beginBattle 的 `funds=0` 与 nextRound 的
// `funds=baseFunding(...)` 一执行就退回普通数值，和利息／金币类效果互动后就不是无限了。
export const INFINITE_FUNDS=Number.MAX_SAFE_INTEGER;
export function suspendState(state,now=Date.now()){return {schemaVersion:1,savedAt:now,expiresAt:now+86400000,state:JSON.parse(JSON.stringify(state))};}
export function resumeState(save,now=Date.now()){if(save.schemaVersion!==1||now>=save.expiresAt||!save.state)return {ok:false,reason:'expired-or-invalid'};return {ok:true,state:JSON.parse(JSON.stringify(save.state))};}
export class PreparationState {
 constructor(data,modeId,{round=1,funds,offers=[],board=null,cat=false}={}){funds??=baseFunding(round);if(!Number.isFinite(funds)||funds<0)throw Error('Invalid funding');this.data=data;this.board=board;this.s={modeId,phase:'prep',round,funds,level:1,discount:Math.max(0,round-1),units:[],items:[],offers:offers.slice(),locked:false,seq:0,rewardPending:null,events:[],stock:{}};ensureStock(data,this.s);
  // 海猫模式在建对局时就锁定无限资金，且早于任何 startPreparation／效果发放，
  // 这样连初始整备期的入账也走 cat 分支。
  if(cat){this.s.cat=true;this.s.funds=INFINITE_FUNDS;}
 }
 terms(){return shopTerms(this.data,this.s.modeId,this.s.level,this.s.discount);}
 // 整备区（手牌）＝未上场干员 → 未装备装备 → 未放置的召唤物卡，三者同序，只认这个总数。
 // 已经放到场上的召唤物卡不占格（它已经在阵地上了），未放置的在整备区里显示一格。
 hand(){const deployed=u=>u.position!==null,c=this.s.summonCards;return [...this.s.units.filter(u=>!deployed(u)),...this.s.items,...(Array.isArray(c)?c.filter(x=>!deployed(x)):[])];}
 handLength(){return this.hand().length;}
 // 达到或超过上限即禁止购入干员／装备；效果发放的卡牌不经过这里，所以能临时超出。
 handFull(){return this.handLength()>=HAND_LIMIT;}
 // 资金写入的两个唯一入口：setFunds 用于「重置成某个值」，addFunds 用于入账／出账。
 // 海猫模式下两者都只保证「仍然是无限」，不做任何真实加减（避免出现 MAX+MAX 这种越界值）。
 setFunds(value){this.s.funds=this.s.cat?INFINITE_FUNDS:value;return this.s.funds;}
 addFunds(delta){this.s.funds=this.s.cat?INFINITE_FUNDS:this.s.funds+delta;return this.s.funds;}
 gain(chessId){ensureStock(this.data,this.s);const shop=this.data.season.charShopChessDatas[chessId],chess=this.data.season.charChessDataDict[chessId];if(!shop||!chess)throw Error('Unknown operator chess');const u={uid:++this.s.seq,chessId,charId:shop.charId,rank:shop.chessLevel,position:null,dir:0,equipment:[]};this.s.units.push(u);this.s.events.push({type:'gain',uid:u.uid,chessId});const copies=this.s.units.filter(x=>x.chessId===chessId);if(copies.length>=chess.upgradeNum&&chess.upgradeChessId){const group=copies.slice(0,chess.upgradeNum),anchor=group.find(x=>x.position!==null)||group[0];for(const x of group)this.s.items.push(...x.equipment);this.s.units=this.s.units.filter(x=>!group.includes(x));const merged={...anchor,uid:++this.s.seq,chessId:chess.upgradeChessId,equipment:[],purchases:{}};for(const x of group)addPurchases(merged.purchases,x.purchases);this.s.units.push(merged);this.s.rewardPending={tier:Math.min(6,this.s.level+1)};this.s.events.push({type:'promote',uid:merged.uid});return merged;}return u;}
 buy(index){if(this.s.phase!=='prep'||this.s.rewardPending)return {ok:false,code:'WRONG_PHASE'};const id=this.s.offers[index],shop=this.data.season.charShopChessDatas[id];if(!shop||shop.chessLevel>this.s.level)return {ok:false,code:'INVALID_OFFER'};const cost=purchasePrice(this.data,id),copies=this.s.units.filter(u=>u.chessId===id).length;if(this.s.funds<cost)return {ok:false,code:'NO_FUNDS'};if(this.handFull()&&copies<2)return {ok:false,code:'FULL_HAND'};if(stockOf(this.data,this.s,id)<=0)return {ok:false,code:'NO_STOCK'};this.s.stock[id]-=1;this.addFunds(-cost);this.s.offers[index]=null;const unit=this.gain(id);unit.purchases??={};unit.purchases[id]=(unit.purchases[id]||0)+1;return {ok:true};}
 deploy(uid,x,y,dir){if(!this.board||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=this.board.cols||y>=this.board.rows||this.board.grid[y][x].buildableType==='NONE')return false;if(this.s.phase!=='prep'||!Number.isInteger(dir)||dir<0||dir>3)return false;const u=this.s.units.find(u=>u.uid===uid);if(!u)return false;const other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y);if(!other&&u.position===null&&this.s.units.filter(v=>v.position!==null).length>=8)return false;const old=u.position;if(other)other.position=old;u.position={x,y};if(old===null)u.dir=dir;return true;}
 upgrade(){const price=this.terms().upgradeCost;if(this.s.phase!=='prep'||price===null||this.s.funds<price||this.s.rewardPending)return false;this.addFunds(-price);this.s.level++;this.s.discount=0;return true;}
 refresh(offers){if(this.s.phase!=='prep'||this.s.rewardPending||this.s.funds<this.terms().refreshCost)return false;if(offers.some(id=>!this.data.season.charShopChessDatas[id]||this.data.season.charShopChessDatas[id].chessLevel>this.s.level))return false;this.addFunds(-this.terms().refreshCost);this.s.offers=offers.slice();this.s.locked=false;return true;}
 takePromotion(chessId){const shop=this.data.season.charShopChessDatas[chessId];if(!this.s.rewardPending||!shop||shop.chessLevel!==this.s.rewardPending.tier||shop.isHidden)return false;this.s.rewardPending=null;this.gain(chessId);return true;}
 sell(uid){if(this.s.phase!=='prep'||this.s.rewardPending)return false;const unit=this.s.units.find(u=>u.uid===uid);if(!unit)return false;this.s.units=this.s.units.filter(u=>u.uid!==uid);this.s.items.push(...unit.equipment);this.addFunds(this.data.season.shopCharChessInfoData[unit.rank][this.data.season.charChessDataDict[unit.chessId].isGolden?1:0].chessSoldPrice);restoreStock(this.s,unit);this.s.events.push({type:'sell',uid});return true;}
 finishBattle({success,leaks=0}){if(this.s.phase!=='battle'||typeof success!=='boolean'||!Number.isInteger(leaks)||leaks<0)return false;this.s.lastBattle={success,leaks};this.s.phase=success?'intermission':'finished';return true;}
 nextRound(offers=[],{hiddenQualified=false}={}){if(this.s.phase!=='intermission'||!Array.isArray(offers)||offers.some(id=>!this.data.season.charShopChessDatas[id]))return false;const rounds=buildPhasePlan(this.data,this.s.modeId),next=rounds.find(r=>r.round===this.s.round+1);if(this.s.round>=rounds.length||(next?.isConditional&&!hiddenQualified)){this.s.phase='finished';return true;}this.s.round++;this.s.discount++;this.setFunds(baseFunding(this.s.round));if(!this.s.locked)this.s.offers=offers.slice();this.s.locked=false;this.s.decisionRequired=next?.battles.some(b=>b.isSpPrepare)||false;this.s.phase=this.s.decisionRequired?'decision':'prep';return true;}
 // 开战前丢掉超过上限的整备区卡牌：判定顺序与整备区显示一致（未上场干员 → 装备 → 未放置的召唤物卡）。
 beginBattle(){if(this.s.phase!=='prep'||this.s.rewardPending)return false;this.setFunds(0);if(!this.s.locked)this.s.offers=[];const cards=this.hand(),overflow=new Set(cards.slice(HAND_LIMIT).map(i=>i.uid));this.s.units=this.s.units.filter(u=>!overflow.has(u.uid));this.s.items=this.s.items.filter(i=>!overflow.has(i.uid));if(Array.isArray(this.s.summonCards))this.s.summonCards=this.s.summonCards.filter(c=>!overflow.has(c.uid));this.s.phase='battle';return true;}
}
