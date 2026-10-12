// 定向研究采集，不修改运行数据、历史快照目录或 data/prts/latest.json。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readTemplates,selectBattleTemplates,operatorRecord} from './prts-parser.mjs';

const names=['维什戴尔','赤刃明霄陈','阿斯卡纶','望','克莱门莎','魂灵之影','棋子'];
const directory=path.resolve('data/prts/research/custom-operators-2026-10-12');
const url='https://prts.wiki/api.php?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'revisions',rvslots:'main',rvprop:'ids|timestamp|content',titles:names.join('|')});
const response=await fetch(url,{headers:{'User-Agent':'GarrisonProtocolCustomOperatorResearch/1.0 (read-only)'},signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error('PRTS HTTP '+response.status);
const payload=await response.json();if(payload.error)throw Error(JSON.stringify(payload.error));
const pages=payload.query.pages.map(page=>{
 const revision=page.revisions?.[0],content=revision?.slots?.main?.content;
 if(typeof content!=='string')throw Error('缺少正文 '+page.title);
 const parsed=readTemplates(content);if(parsed.unbalanced)throw Error('模板未闭合 '+page.title);
 return {pageid:page.pageid,title:page.title,categories:names.indexOf(page.title)<5?['干员']:['召唤物'],revisionId:revision.revid,revisionAt:revision.timestamp,retrievedAt:new Date().toISOString(),contentHash:crypto.createHash('sha256').update(content).digest('hex'),templateNames:parsed.templates.map(t=>t.name),unbalanced:false,templates:selectBattleTemplates(parsed.templates)};
}).sort((a,b)=>names.indexOf(a.title)-names.indexOf(b.title));
if(pages.length!==names.length||names.some(name=>!pages.some(p=>p.title===name)))throw Error('定向页面集合不完整');
const operators=pages.filter(p=>p.categories.includes('干员')).map(operatorRecord);
if(operators.some(op=>op.skills.length!==3||!op.gameId))throw Error('干员技能或身份未完整解析');
await fs.mkdir(directory,{recursive:true});
const supportTitles=['术语释义','异常效果','特殊机制','分支特性信息/data','微件:Range/x-1','微件:Range/x-5','微件:Range/x-6'];
const supportUrl='https://prts.wiki/api.php?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'revisions',rvslots:'main',rvprop:'ids|timestamp|content',titles:supportTitles.join('|')});
const supportResponse=await fetch(supportUrl,{headers:{'User-Agent':'GarrisonProtocolCustomOperatorResearch/1.0 (read-only)'},signal:AbortSignal.timeout(45000)});
if(!supportResponse.ok)throw Error('PRTS support HTTP '+supportResponse.status);
const supportPayload=await supportResponse.json();if(supportPayload.error)throw Error(JSON.stringify(supportPayload.error));
const termIds=new Set(['ba.sluggish','ba.overdrive','ba.weaknessatk','ba.dt.erosion2','ba.addash']);
const statusNames=new Set(['无敌','无法行动','不可阻挡','阻回','静默','强制缴械','放逐','自缚','BUFF可抵挡','BUFF抵挡','被传送','迷彩','孤立']);
const mechanics=new Set(['借用持有者的攻击力','免疫传送','盲区','固定弱点']);
const supporting=supportPayload.query.pages.map(page=>{
 const revision=page.revisions?.[0],content=revision?.slots?.main?.content;if(typeof content!=='string')throw Error('缺少支持资料 '+page.title);
 let selected=[];
 if(page.title==='术语释义')selected=readTemplates(content).templates.filter(t=>t.name==='术语释义'&&termIds.has(t.fields.id));
 else if(page.title==='异常效果')selected=readTemplates(content).templates.filter(t=>t.name==='异常效果表格'&&statusNames.has(t.fields['3']));
 else if(page.title==='特殊机制')selected=readTemplates(content).templates.filter(t=>t.name==='特殊机制表格'&&mechanics.has(t.fields['1']));
 const sections=page.title==='分支特性信息/data'?content.match(/==(?:本源近卫|投掷手|陷阱师|伏击客|术战者)==\n[\s\S]*?(?=\n==|$)/g):null;
 return {pageid:page.pageid,title:page.title,revisionId:revision.revid,revisionAt:revision.timestamp,retrievedAt:new Date().toISOString(),contentHash:crypto.createHash('sha256').update(content).digest('hex'),templates:selected,...(sections?{sections}:{}),...(page.title.startsWith('微件:')?{content}:{})};
});
if(supporting.length!==supportTitles.length)throw Error('支持资料集合不完整');
const base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8'));
const comparisons=[],missingEntities=[];
for(const operator of operators){
 const entity=base.entities[operator.gameId];if(!entity){missingEntities.push(operator.gameId);continue;}
 for(const skill of operator.skills)for(const level of skill.levels){
  const index=level.level.startsWith('专精')?6+Number(level.level.at(-1)):Number(level.level)-1;
  const native=base.skills[entity.skillRefs[skill.slot-1].skillId].levels[index];
  for(const [field,prts,game]of [['initSp',level.initialSP,native.spData.initSp],['spCost',level.cost,native.spData.spCost],['duration',level.duration,native.duration]])if(prts!==null)comparisons.push({operator:operator.name,slot:skill.slot,level:level.level,field,prts,game,equal:prts===game});
 }
 for(const module of operator.modules.filter(m=>m.fields.基础证章!=='yes')){
  const native=base.modules[module.fields.模组图标];if(!native)throw Error('缺少模组 '+module.fields.模组图标);
  for(const phase of native.phases)for(const [label,key]of Object.entries({生命:'max_hp',攻击:'atk',防御:'def',攻击速度:'attack_speed'})){
   const value=module.fields[label+(phase.equipLevel===1?'':phase.equipLevel)];if(value===undefined)continue;
   const game=phase.attributeBlackboard.find(row=>row.key===key)?.value??0,prts=Number(value);if(!Number.isFinite(prts))throw Error('模组属性无法解析 '+value);
   comparisons.push({operator:operator.name,module:native.id,level:phase.equipLevel,field:key,prts,game,equal:prts===game});
  }
 }
}
const comparison={nativeCommit:base.source.commit,scope:'Numeric SP, finite duration, and module stat comparison; matching numbers do not verify skill behavior',checks:comparisons.length,mismatches:comparisons.filter(row=>!row.equal),missingEntities,comparisons};
for(const [file,value]of Object.entries({'pages.json':pages,'operators.json':operators,'supporting.json':supporting,'comparison.json':comparison}))await fs.writeFile(path.join(directory,file),JSON.stringify(value,null,2)+'\n');
const manifest={scope:'Five requested custom operators and two attached objects; research only, not a full PRTS catalog or playable capability verification',source:'PRTS MediaWiki API',fetchedAt:new Date().toISOString(),files:{}};
for(const file of ['pages.json','operators.json','supporting.json','comparison.json'])manifest.files[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(directory,file))).digest('hex');
await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory,pages:pages.map(p=>({name:p.title,revision:p.revisionId})),supporting:supporting.map(p=>({name:p.title,revision:p.revisionId})),operators:operators.length,skills:operators.reduce((n,o)=>n+o.skills.length,0),numericChecks:comparison.checks,mismatches:comparison.mismatches,missingEntities},null,2));
