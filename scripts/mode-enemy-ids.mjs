export function collectModeEnemies(data){
 const refs=new Map();const add=(id,kind)=>{if(!refs.has(id))refs.set(id,new Set());refs.get(id).add(kind);};
 for(const id of new Set(Object.values(data.season.enemyInfoDict).flat()))add(id,'random-pool');
 for(const effects of Object.values(data.season.effectBuffInfoDataDict))for(const e of effects)for(const b of e.blackboard||[])if(/enemy/i.test(b.key)&&typeof b.valueStr==='string')for(const m of b.valueStr.matchAll(/enemy_[0-9]+_[a-zA-Z0-9_]+/g))add(m[0],'mode-effect');
 for(const[key,id]of Object.entries(data.common.constData))if(key.startsWith('templateEnemy'))add(id,'template');
 return [...refs].map(([id,kinds])=>({id,kinds:[...kinds]}));
}
