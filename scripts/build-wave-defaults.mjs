import fs from 'node:fs/promises';

const sourcePath = 'data/modes/alliance-lower/default-wave-table.json';
const outputPath = 'dist/native-wave-defaults.js';
const table = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const activities = JSON.parse(await fs.readFile('data/prts/enemy-activities.json', 'utf8'));
const {NATIVE_DATA} = await import('../dist/runtime-data.js');
const groups = Object.fromEntries(NATIVE_DATA.enemyIndex.map(e=>{
  const entry=activities.entries[e.id];
  if(entry?.activities?.length!==1)throw new Error(`敌人活动归属须逐条核定: ${e.id}`);
  return [e.id,{activity:entry.activities[0],url:entry.url,eligible:e.enemyBehavior.randomPoolEligible===true}];
}));

if (!table || typeof table !== 'object' || !table.types || typeof table.types !== 'object') {
  throw new Error(`${sourcePath} 不是有效的波次表导出文件`);
}

for(const tiers of Object.values(table.types))for(const pack of Object.values(tiers))for(const slot of pack.templates){
  if(!slot.pool.length||slot.pool.some(id=>!groups[id]?.eligible||groups[id].activity!==slot.activity))throw new Error(`默认模板含未准入或跨活动敌人: ${slot.name}`);
}
const output=`// Generated from ${sourcePath} and data/prts/enemy-activities.json.\nexport const ENEMY_ACTIVITY_GROUPS = ${JSON.stringify(groups,null,2)};\nexport const DEFAULT_WAVE_TABLE = ${JSON.stringify(table, null, 2)};\n`;
// 与 build-browser 相同：Windows 上连续构建时短暂文件占用可重试。
for(let attempt=0;;attempt++){
  try{await fs.writeFile(outputPath,output);break;}
  catch(error){if(attempt>=3||!['EBUSY','EPERM','UNKNOWN'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}
}
console.log(`Built ${outputPath} from ${sourcePath}`);
