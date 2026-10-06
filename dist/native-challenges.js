export const WEEKLY_CHALLENGE_SCHEMA_VERSION=1;
export const WEEKLY_CHALLENGE_HOOKS=Object.freeze({UNIT_STATS:'unit.stats',OPERATOR_BONDS:'operator.bonds',ENEMY_POOL:'enemy.pool'});

const EFFECT_HANDLERS=new Map();
const VALID_HOOKS=new Set(Object.values(WEEKLY_CHALLENGE_HOOKS));
const isoWithZone=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)&&Number.isFinite(Date.parse(value));
const textValue=value=>typeof value==='string'&&value.trim().length>0;

export function registerWeeklyChallengeEffectHandler(type,handler){
 if(!textValue(type)||typeof handler!=='function')throw new TypeError('每周挑战效果处理器必须有类型和函数');
 if(EFFECT_HANDLERS.has(type))throw new Error('重复的每周挑战效果处理器：'+type);
 EFFECT_HANDLERS.set(type,handler);
}

registerWeeklyChallengeEffectHandler('add-bond',(bonds,params)=>{
 const bondId=typeof params.bondId==='string'?params.bondId.trim():'';
 return bondId?[...new Set([...(Array.isArray(bonds)?bonds:[]),bondId])]:[...(Array.isArray(bonds)?bonds:[])];
});
registerWeeklyChallengeEffectHandler('filter-prts-kind',(enemyIds,params,{data}={})=>{
 const kind=typeof params.kind==='string'?params.kind.trim():'';
 if(!kind||!Array.isArray(enemyIds))return [];
 return [...new Set(enemyIds.filter(id=>data?.enemies?.[id]?.prtsRace===kind))];
});

export function validateWeeklyChallengeSchedule(schedule,{modeIds=null,mapIds=null,finalBossIds=null}={}){
 const errors=[];
 if(!schedule||typeof schedule!=='object'||schedule.schemaVersion!==WEEKLY_CHALLENGE_SCHEMA_VERSION)return ['每周挑战时间表 schemaVersion 必须为 1'];
 if(!textValue(schedule.timeZone))errors.push('每周挑战时间表缺少 timeZone');
 else try{new Intl.DateTimeFormat('zh-Hans-CN',{timeZone:schedule.timeZone});}catch{errors.push('每周挑战时间表 timeZone 无效：'+schedule.timeZone);}
 if(!Array.isArray(schedule.entries)){errors.push('每周挑战时间表 entries 必须是数组');return errors;}
 const ids=new Set(),intervals=[];
 for(const [index,entry] of schedule.entries.entries()){
  const label=`entries[${index}]`;
  if(!entry||typeof entry!=='object'){errors.push(`${label} 必须是对象`);continue;}
  if(!textValue(entry.id)||ids.has(entry.id))errors.push(`${label}.id 必须存在且不可重复`);else ids.add(entry.id);
  if(!textValue(entry.challengeId))errors.push(`${label}.challengeId 必须存在`);
  if(!textValue(entry.title))errors.push(`${label}.title 必须存在`);
  if(!textValue(entry.description))errors.push(`${label}.description 必须存在`);
  if(!isoWithZone(entry.startsAt)||!isoWithZone(entry.endsAt)||Date.parse(entry.startsAt)>=Date.parse(entry.endsAt))errors.push(`${label} 的 startsAt/endsAt 必须是带时区且有效的时间范围`);
  else intervals.push({id:entry.id,start:Date.parse(entry.startsAt),end:Date.parse(entry.endsAt)});
  if(entry.allowedModeIds!==undefined&&(!Array.isArray(entry.allowedModeIds)||entry.allowedModeIds.some(id=>!textValue(id))))errors.push(`${label}.allowedModeIds 必须是字符串数组`);
  else if(modeIds&&entry.allowedModeIds?.some(id=>!modeIds.has(id)))errors.push(`${label}.allowedModeIds 包含未知模式`);
  if(entry.mapId!==undefined&&entry.mapId!==null&&(!textValue(entry.mapId)||mapIds&&!mapIds.has(entry.mapId)))errors.push(`${label}.mapId 指向未知地图`);
  if(entry.finalBossId!==undefined&&entry.finalBossId!==null&&(!textValue(entry.finalBossId)||finalBossIds&&!finalBossIds.has(entry.finalBossId)))errors.push(`${label}.finalBossId 指向未知最终 Boss`);
  if(entry.rules!==undefined&&(!Array.isArray(entry.rules)||entry.rules.length>32))errors.push(`${label}.rules 必须是最多 32 项的数组`);
  else for(const [ruleIndex,rule] of (entry.rules||[]).entries())if(!rule||!textValue(rule.id)||!textValue(rule.title)||!textValue(rule.description))errors.push(`${label}.rules[${ruleIndex}] 必须包含 id/title/description`);
  if(entry.effects!==undefined&&(!Array.isArray(entry.effects)||entry.effects.length>64))errors.push(`${label}.effects 必须是最多 64 项的数组`);
  else for(const [effectIndex,effect] of (entry.effects||[]).entries()){
   if(!effect||!textValue(effect.hook)||!textValue(effect.type))errors.push(`${label}.effects[${effectIndex}] 必须包含 hook/type`);
   else if(!VALID_HOOKS.has(effect.hook))errors.push(`${label}.effects[${effectIndex}] 使用了未接入的钩子：${effect.hook}`);
   else if(!EFFECT_HANDLERS.has(effect.type))errors.push(`${label}.effects[${effectIndex}] 使用了未登记的处理器：${effect.type}`);
   if(effect?.params!==undefined&&(!effect.params||typeof effect.params!=='object'||Array.isArray(effect.params)))errors.push(`${label}.effects[${effectIndex}].params 必须是对象`);
  }
 }
 intervals.sort((a,b)=>a.start-b.start);
 for(let i=1;i<intervals.length;i++)if(intervals[i].start<intervals[i-1].end)errors.push(`挑战时间范围重叠：${intervals[i-1].id} 与 ${intervals[i].id}`);
 return errors;
}

export function weeklyChallengeAt(schedule,networkEpoch){
 if(!Number.isFinite(networkEpoch)||!Array.isArray(schedule?.entries))return null;
 const entry=schedule.entries.find(row=>networkEpoch>=Date.parse(row.startsAt)&&networkEpoch<Date.parse(row.endsAt));
 if(!entry)return null;
 return structuredClone({...entry,timeZone:schedule.timeZone,schemaVersion:WEEKLY_CHALLENGE_SCHEMA_VERSION});
}

export function weeklyChallengeSnapshot(challenge,networkEpoch){
 if(!challenge)return null;
 const snapshot={
  schemaVersion:WEEKLY_CHALLENGE_SCHEMA_VERSION,
  id:String(challenge.id||''),
  challengeId:String(challenge.challengeId||''),
  title:String(challenge.title||''),
  description:String(challenge.description||''),
  startsAt:String(challenge.startsAt||''),
  endsAt:String(challenge.endsAt||''),
  timeZone:String(challenge.timeZone||'UTC'),
  allowedModeIds:Array.isArray(challenge.allowedModeIds)?[...challenge.allowedModeIds]:[],
  mapId:challenge.mapId||null,
  finalBossId:challenge.finalBossId||null,
  rules:structuredClone(challenge.rules||[]),
  effects:structuredClone(challenge.effects||[]),
  matchedAt:Number.isFinite(networkEpoch)?new Date(networkEpoch).toISOString():null
 };
 return snapshot;
}

export function validateWeeklyChallengeSnapshot(challenge){
 if(challenge==null)return true;
 if(!challenge||typeof challenge!=='object'||challenge.schemaVersion!==WEEKLY_CHALLENGE_SCHEMA_VERSION)return false;
 if(!textValue(challenge.id)||!textValue(challenge.challengeId)||!textValue(challenge.title)||!textValue(challenge.description))return false;
 if(!isoWithZone(challenge.startsAt)||!isoWithZone(challenge.endsAt)||Date.parse(challenge.startsAt)>=Date.parse(challenge.endsAt))return false;
 if(!textValue(challenge.timeZone)||!Array.isArray(challenge.allowedModeIds)||!Array.isArray(challenge.rules)||!Array.isArray(challenge.effects))return false;
 try{new Intl.DateTimeFormat('zh-Hans-CN',{timeZone:challenge.timeZone});}catch{return false;}
 if(challenge.allowedModeIds.some(id=>!textValue(id))||(challenge.mapId!==null&&!textValue(challenge.mapId))||(challenge.finalBossId!==null&&challenge.finalBossId!==undefined&&!textValue(challenge.finalBossId)))return false;
 if(challenge.rules.length>32||challenge.rules.some(rule=>!rule||!textValue(rule.id)||!textValue(rule.title)||!textValue(rule.description)))return false;
 if(challenge.effects.length>64||challenge.effects.some(effect=>!effect||!textValue(effect.hook)||!VALID_HOOKS.has(effect.hook)||!textValue(effect.type)||!EFFECT_HANDLERS.has(effect.type)||(effect.params!==undefined&&(!effect.params||typeof effect.params!=='object'||Array.isArray(effect.params)))))return false;
 if(challenge.matchedAt!==null&&challenge.matchedAt!==undefined&&!Number.isFinite(Date.parse(challenge.matchedAt)))return false;
 return true;
}

export function runWeeklyChallengeHook(challenge,hook,payload,context={}){
 if(!challenge||!Array.isArray(challenge.effects)||challenge.effects.length===0)return payload;
 let value=payload;
 for(const effect of challenge.effects){
  if(effect.hook!==hook)continue;
  const handler=EFFECT_HANDLERS.get(effect.type);
  if(handler)value=handler(value,structuredClone(effect.params||{}),context,challenge);
 }
 return value;
}

export const fetchNetworkEpoch=async ({fetchImpl=globalThis.fetch,href=globalThis.location?.href,timeoutMs=7000}={})=>{
 if(typeof fetchImpl!=='function'||!href||typeof AbortController!=='function'||!globalThis.performance?.now)throw new Error('network-time-unavailable');
 const url=new URL(href);
 url.searchParams.set('__weekly_challenge_clock',Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2));
 const controller=new AbortController(),startedAt=performance.now(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(url.href,{method:'HEAD',cache:'no-store',credentials:'same-origin',redirect:'follow',headers:{'Cache-Control':'no-cache, no-store, max-age=0'},signal:controller.signal});
  if(!response.ok)throw new Error('network-time-unavailable');
  const dateHeader=response.headers?.get?.('date');
  const serverEpoch=Date.parse(dateHeader||'');
  const age=Number(response.headers?.get?.('age'));
  if(!Number.isFinite(serverEpoch)||(Number.isFinite(age)&&age>5))throw new Error('network-time-unavailable');
  return serverEpoch+Math.max(0,performance.now()-startedAt)/2;
 }catch(error){throw new Error('network-time-unavailable',{cause:error});}
 finally{clearTimeout(timeout);}
};
