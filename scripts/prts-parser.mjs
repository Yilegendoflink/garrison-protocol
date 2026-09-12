// A deliberately non-evaluating Wikitext reader: preserve templates, never execute them.
export function splitTopLevel(text, delimiter='|') {
  const parts=[];let start=0;const stack=[];
  for(let i=0;i<text.length;i++){
    if(text.startsWith('{{{',i)){stack.push('}}}');i+=2;}
    else if(text.startsWith('{{',i)){stack.push('}}');i++;}
    else if(text.startsWith('[[',i)){stack.push(']]');i++;}
    else if(stack.length&&text.startsWith(stack.at(-1),i)){i+=stack.pop().length-1;}
    else if(text[i]===delimiter&&!stack.length){parts.push(text.slice(start,i));start=i+1;}
  }
  parts.push(text.slice(start));return parts;
}
export function readTemplates(wikitext){
  const text=wikitext.replace(/<!--[\s\S]*?-->/g,'');const result=[];const stack=[];let start=-1;
  for(let i=0;i<text.length;i++){
    if(text.startsWith('{{{',i)){stack.push('}}}');i+=2;}
    else if(text.startsWith('{{',i)){if(!stack.length)start=i;stack.push('}}');i++;}
    else if(stack.length&&text.startsWith(stack.at(-1),i)){
      const close=stack.pop();i+=close.length-1;
      if(!stack.length&&start>=0){const parts=splitTopLevel(text.slice(start+2,i-1));const name=parts.shift().trim().replace(/^模板:|^Template:/i,'');const fields={};const duplicates=[];let position=1;
        for(const part of parts){const pieces=splitTopLevel(part,'=');const key=pieces.length>1?pieces.shift().trim():String(position++),value=pieces.join('=').trim();if(Object.hasOwn(fields,key))duplicates.push(key);fields[key]=value;}
        result.push({name,fields,...(duplicates.length?{duplicateFields:duplicates}:{})});start=-1;
      }
    }
  }
  return {templates:result,unbalanced:stack.length>0};
}
export function number(value){if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value.trim()))return null;return Number(value);}
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(obj,k)).map(k=>[k,obj[k]]));
export function selectBattleTemplates(templates){
 return templates.filter(t=>/^(CharinfoV2|属性|干员攻击范围|天赋列表\d*|潜能提升|技能\d*|模组|敌人信息(?:\/.*)?|召唤物信息(?:\/.*)?|召唤物天赋|无等级技能|干员获得方式)$/i.test(t.name)).map(t=>{
  let fields=t.fields;
  if(/^Charinfo/i.test(t.name))fields=pick(fields,['干员名','干员外文名','干员名jp','干员id','干员序号','稀有度','职业','分支','位置','特性','标签','所属国家','所属组织','所属团队']);
  else if(t.name==='模组')fields=Object.fromEntries(Object.entries(fields).filter(([k])=>!/^基础信息|任务|材料|描述/.test(k)));
  else if(t.name.startsWith('敌人信息'))fields=Object.fromEntries(Object.entries(fields).filter(([k])=>!/^描述|登场活动|相关敌人/.test(k)));
  return {...t,fields};
 });
}
const provenance=page=>({pageId:page.pageid,revisionId:page.revisionId,revisionAt:page.revisionAt,retrievedAt:page.retrievedAt,url:`https://prts.wiki/w/${encodeURIComponent(page.title)}`,revisionUrl:`https://prts.wiki/index.php?oldid=${page.revisionId}`,contentHash:page.contentHash});
export function operatorRecord(page){
 const find=n=>page.templates.find(t=>t.name===n)?.fields||{};const info=find('CharinfoV2'),attrs=find('属性'),ranges=find('干员攻击范围');
 const phases=[0,1,2].filter(p=>Object.keys(attrs).some(k=>k.startsWith(`精英${p}_`))).map(p=>({phase:p,maxLevel:number(attrs[`精英${p}_满级`]),anchors:Object.fromEntries(['1级','满级'].map(level=>[level,Object.fromEntries([['maxHp','生命上限'],['attack','攻击'],['defense','防御'],['resistance','法术抗性']].map(([k,cn])=>[k,number(attrs[`精英${p}_${level}_${cn}`])]))])),rangeId:ranges[`精英${p}范围`]||null}));
 for(const phase of phases){phase.derivedAnchors={};for(const stat of ['maxHp','attack','defense','resistance'])if(phase.anchors['1级'][stat]===null){const previous=phases.find(p=>p.phase===phase.phase-1);const value=stat==='resistance'?phase.anchors['满级'].resistance:previous?.anchors['满级'][stat];if(value!==null&&value!==undefined){phase.anchors['1级'][stat]=value;phase.derivedAnchors[stat]={method:stat==='resistance'?'current-phase-constant':'previous-phase-max',sourceRevision:306583,sourceUrl:'https://prts.wiki/index.php?oldid=306583'};}}}
 const skills=page.templates.filter(t=>/^技能\d*$/.test(t.name)).map((t,i)=>({id:`prts:skill:${page.pageid}:${i+1}`,slot:i+1,name:t.fields['技能名']||null,recovery:t.fields['技能类型1']||null,activation:t.fields['技能类型2']||null,levels:[...Array(7)].map((_,i)=>String(i+1)).concat(['专精1','专精2','专精3']).filter(l=>Object.keys(t.fields).some(k=>k.startsWith('技能'+l))).map(l=>({level:l,initialSP:number(t.fields[`技能${l}初始`]),cost:number(t.fields[`技能${l}消耗`]),duration:number(t.fields[`技能${l}持续`]),descriptionWikitext:t.fields[`技能${l}描述`]??null})),sourceTemplate:t}));
 const missing=[];if(!info['干员id'])missing.push('gameId');if(!phases.length)missing.push('attributes');const skillAvailability=skills.length?'recorded':'none-declared';
 return {id:`prts:operator:${page.pageid}`,name:info['干员名']||page.title,gameId:info['干员id']||null,categories:page.categories,rarity:number(info['稀有度'])===null?null:number(info['稀有度'])+1,profession:info['职业']||null,branch:info['分支']||null,position:info['位置']||null,skillAvailability,phases,baseParameters:{redeploy:attrs['再部署']??null,cost:attrs['部署费用']??null,block:attrs['阻挡数']??null,attackInterval:attrs['攻击速度']??null},trust:Object.fromEntries(['生命上限','攻击','防御'].map(k=>[k,number(attrs[`信赖加成_${k}`])])),skills,talents:page.templates.filter(t=>/^天赋列表/.test(t.name)),modules:page.templates.filter(t=>t.name==='模组'),potentials:find('潜能提升'),source:provenance(page),quality:{missing,simulationReady:false,notes:['起始属性按已核对的PRTS计算器推导并记录derivedAnchors；仍无法确定的值保持null','技能与天赋的文字未转换成可执行效果','前摇、弹速、历史版本、关卡覆盖值需另行核实']}};
}
const enemyFields={maxHp:'最大生命值',attack:'攻击力',defense:'防御力',resistance:'法术抗性',moveSpeed:'移动速度',attackInterval:'攻击间隔',attackSpeed:'攻击速度',range:'攻击范围半径',weight:'重量等级',hpRegen:'生命恢复速度',taunt:'基础嘲讽等级',lifeCost:'数量',elementResistance:'元素抗性',elementDamageResistance:'损伤抵抗',initialSP:'初始技力',spCapacity:'技力上限',spRegen:'技力回复速度'};
export function enemyRecord(page){
 const common=page.templates.find(t=>/^敌人信息\/(common2|common)$/.test(t.name))?.fields||{};
 const rawLevels=page.templates.filter(t=>t.name==='敌人信息/levelcontent').map(t=>({index:number(t.fields.index),fields:t.fields})).sort((a,b)=>(a.index??Infinity)-(b.index??Infinity));
 const byLevel=new Map();const levels=rawLevels.map(l=>{const previous=byLevel.get(l.index-1),inheritedFrom={},effective={...l.fields};
  // The PRTS template inherits only the immediately preceding numeric level.
  if(previous)for(const [key,value]of Object.entries(previous.effective))if(key!=='index'&&!Object.hasOwn(effective,key)){effective[key]=value;inheritedFrom[key]=previous.inheritedFrom[key]??previous.level;}
  const out={level:l.index,overrides:l.fields,effective,inheritedFrom,stats:Object.fromEntries(Object.entries(enemyFields).map(([key,cn])=>[key,number(effective[cn])])),immunities:Object.fromEntries(Object.entries(effective).filter(([k])=>k.endsWith('抗性')&&!['法术抗性','元素抗性'].includes(k))),talentWikitext:effective['天赋']??null};byLevel.set(l.index,out);return out;});
 const missing=[];if(!Object.keys(common).length)missing.push('commonTemplate');if(!levels.length)missing.push('levels');
 return {id:`prts:enemy:${page.pageid}`,name:common['名称']||page.title,gameId:null,codexId:common.index||null,sortId:number(common.id),rank:common['地位级别']||null,race:common['种类']||null,attackType:common['攻击方式']||null,damageType:common['伤害类型']||null,motion:common['行动方式']||null,categories:page.categories,levels,source:provenance(page),quality:{missing,simulationReady:false,notes:['PRTS图鉴编号和排序号不是客户端enemyId','未在页面明确给出的数值保持null','具体关卡可能覆盖通常数值','正文中的特殊AI需要单独结构化核对']}};
}
export function summarize(operators,enemies,summons,inventory){
 const missing=records=>records.filter(r=>r.quality.missing.length).map(r=>({id:r.id,name:r.name,missing:r.quality.missing}));
 return {scope:'PRTS所选分类在本次采集时的页面集合；不等于全部已实装干员数量或可运行内容',expected:inventory.counts,collected:{operators:operators.length,enemies:enemies.length,summons:summons.length,skills:operators.reduce((n,o)=>n+o.skills.length,0),modules:operators.reduce((n,o)=>n+o.modules.filter(m=>m.fields['基础证章']!=='yes').length,0),moduleBadges:operators.reduce((n,o)=>n+o.modules.filter(m=>m.fields['基础证章']==='yes').length,0),enemyLevels:enemies.reduce((n,e)=>n+e.levels.length,0)},issues:{operators:missing(operators),enemies:missing(enemies),operatorsWithoutDeclaredSkills:operators.filter(o=>!o.skills.length).map(o=>({id:o.id,name:o.name})),unresolved:{operatorLevelOneAnchors:operators.reduce((n,o)=>n+o.phases.filter(p=>Object.values(p.anchors['1级']).some(x=>x===null)).length,0),enemyGameIds:enemies.filter(e=>!e.gameId).length,enemyStatValues:enemies.reduce((n,e)=>n+e.levels.reduce((m,l)=>m+Object.values(l.stats).filter(v=>v===null).length,0),0),executableSkillEffects:operators.reduce((n,o)=>n+o.skills.length,0)}},simulationReady:false};
}

export function rangeRecord(page){
 const include=page.content.match(/<includeonly>([\s\S]*?)<\/includeonly>/i)?.[1]||page.content;
 const uses=[...include.matchAll(/<use\b([^>]+)\/?\s*>/g)].map(m=>{const attributes=Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]));return {kind:attributes['xlink:href']||attributes.href,x:number(attributes.x),y:number(attributes.y)};});
 const origin=uses.find(u=>u.kind==='#1');
 const compatible=origin&&uses.every(u=>['#1','#2'].includes(u.kind)&&u.x!==null&&u.y!==null)&&/width="22"/.test(include)&&!(/<path\b|<circle\b|transform=/.test(include));
 const cells=compatible?uses.map(u=>{const bias=u.kind==='#2'?1:0;return {x:(u.x-bias-origin.x)/26,y:(u.y-bias-origin.y)/26,kind:u.kind==='#1'?'origin':'outline'};}):null;
 const valid=cells?.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y));
 return {id:page.title.split('/').slice(1).join('/'),source:{pageId:page.pageid,revisionId:page.revisionId,revisionAt:page.revisionAt,url:'https://prts.wiki/index.php?oldid='+page.revisionId},displayCells:valid?cells:null,status:valid?'display-grid-extracted':'needs-review',simulationReady:false,note:'展示网格不等于攻击碰撞体；中心格与实际攻击触发规则另行校准'};
}
