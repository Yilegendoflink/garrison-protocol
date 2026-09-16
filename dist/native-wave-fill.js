// 词条波次表：每词条 × 压力档可有多套模板。开战时先随机一套，再按该套预算抽怪。
import {DEFAULT_WAVE_TABLE} from './native-wave-defaults.js';
export const WAVE_STORE_KEY='garrison-wave-table-v2';
export const TRAINING_TYPES=[
 {id:'SPECIAL',name:'特异',desc:'输出和承伤突出'},
 {id:'FLY',name:'飞行',desc:'大量空中单位'},
 {id:'TIMES',name:'频次',desc:'需一定攻击次数击破'},
 {id:'ELEMENT',name:'元素',desc:'造成元素损伤'},
 {id:'DOT',name:'持续',desc:'擅长持续伤害'},
 {id:'INVISIBLE',name:'隐匿',desc:'拥有隐匿'},
 {id:'REFLECTION',name:'折射',desc:'拥有折射'}
];
export const PLACEHOLDER_ENEMY='enemy_1422_lrsldr';
export const DEFAULT_BUDGETS={1:10,2:16,3:24};

function cleanPool(pool){return [...new Set((pool||[]).filter(id=>typeof id==='string'&&id))];}

export function emptyTemplate(tier=1){
 return {name:'',budget:DEFAULT_BUDGETS[tier]||10,maxCost:null,pool:[]};
}

export function normalizeTemplate(row,tier=1){
 const budget=Number(row?.budget),maxCost=Number(row?.maxCost);
 const count=Number.isInteger(row?.minCount)&&Number.isInteger(row?.maxCount)&&row.minCount>0&&row.maxCount>=row.minCount?{minCount:Math.min(80,row.minCount),maxCount:Math.min(80,row.maxCount)}:{};
 return {
  ...count,
  name:typeof row?.name==='string'?row.name.slice(0,24):'',
  budget:Number.isFinite(budget)&&budget>=0?budget:DEFAULT_BUDGETS[tier]||10,
  maxCost:Number.isFinite(maxCost)&&maxCost>0?maxCost:null,
  pool:cleanPool(row?.pool)
 };
}

export function templatesOf(slot,tier=1){
 if(Array.isArray(slot?.templates)&&slot.templates.length)return slot.templates.map(row=>normalizeTemplate(row,tier));
 if(slot&&(Array.isArray(slot.pool)||slot.budget!=null))return [normalizeTemplate(slot,tier)];
 return [emptyTemplate(tier)];
}

export function emptyWaveTable(){
 const types=Object.fromEntries(TRAINING_TYPES.map(t=>[t.id,{1:{templates:[emptyTemplate(1)]},2:{templates:[emptyTemplate(2)]},3:{templates:[emptyTemplate(3)]}}]));
 return {version:2,defaultCost:1,costs:{},types};
}

export function defaultWaveTable(){return normalizeWaveTable(DEFAULT_WAVE_TABLE);}

export function normalizeWaveTable(raw){
 const base=emptyWaveTable();if(!raw||typeof raw!=='object')return base;
 base.defaultCost=Math.max(1,Number(raw.defaultCost)||1);
 if(raw.costs&&typeof raw.costs==='object')for(const [id,value] of Object.entries(raw.costs)){const n=Number(value);if(Number.isFinite(n)&&n>0)base.costs[id]=n;}
 for(const type of TRAINING_TYPES){
  const src=raw.types?.[type.id]||raw[type.id]||{};
  for(const tier of [1,2,3])base.types[type.id][tier]={templates:templatesOf(src[tier],tier)};
 }
 return base;
}

export function loadWaveTable(){
 try{if(typeof localStorage!=='undefined'){const raw=JSON.parse(localStorage.getItem(WAVE_STORE_KEY)||'null');if(raw)return normalizeWaveTable(raw);}}catch{}
 return defaultWaveTable();
}

export function saveWaveTable(table){
 const next=normalizeWaveTable(table);
 try{if(typeof localStorage!=='undefined')localStorage.setItem(WAVE_STORE_KEY,JSON.stringify(next));}catch{}
 return next;
}

export function enemyCost(table,id){
 const n=Number(table?.costs?.[id]);
 return Number.isFinite(n)&&n>0?n:Math.max(1,Number(table?.defaultCost)||1);
}

export function tierPack(table,type,tier){
 const row=table?.types?.[type]?.[tier];
 if(!row)return {templates:[emptyTemplate(tier)]};
 if(!Array.isArray(row.templates)||!row.templates.length)row.templates=templatesOf(row,tier);
 return row;
}

export function currentTemplate(table,type,tier,index=0){
 const list=tierPack(table,type,tier).templates;
 return list[Math.max(0,Math.min(index|0,list.length-1))];
}

export function templateLabel(slot,index){return (slot?.name||'').trim()||`模板 ${index+1}`;}

export function tierSlot(table,type,tier){return currentTemplate(table,type,tier,0);}
