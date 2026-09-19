// 技能描述文本渲染。纯函数，不读写战斗状态。
//
// 原作描述里的 {key:format} 占位符与技能黑板取值存在两类命名不一致，原先精确匹配会让
// 界面把这些位置渲染成「—」：
//   1. 大小写不同：HP_RECOVERY_PER_SEC vs 黑板 hp_recovery_per_sec
//   2. 大小写无差异但多一个前导符号：{-def:0%} 对应黑板 def
// 注意占位符里的前导「-」是**字面显示符号**（游戏内显示「-40%」），不能删；
// 只有黑板键本身确实带负号时（如 -demkni_s_3.move_speed）才由键承担该符号。
//
// 数值口径：:0% 表示按百分数显示（黑板存小数，乘 100）；其余按原样输出。
// 技能/天赋描述同样是原表富文本：样式标签（`<@ba.vup>`、`<$ba.stun>`、`</>`）丢掉，
// 内容标签（`<替身>`、`<铜灯盘>` 这类引用名）里的文字保留。
import {richText} from './protocol.js';
export function plainText(value){
 return richText(value);
}
export function normalizeKey(key){
 return String(key??'').replace(/^[-+]/,'').toLowerCase();
}
export function blackboardIndex(blackboard){
 const exact=new Map(),normalized=new Map();
 for(const entry of blackboard||[]){
  if(!entry||entry.key==null)continue;
  const value=entry.valueStr??entry.value,key=String(entry.key);
  if(!exact.has(key))exact.set(key,value);
  const norm=normalizeKey(key);
  if(!normalized.has(norm))normalized.set(norm,value);
 }
 return {exact,normalized};
}
export function blackboardValue(index,key){
 if(!index)return undefined;
 const raw=String(key??'');
 if(index.exact.has(raw))return index.exact.get(raw);
 const stripped=raw.replace(/^[-+]/,'');
 if(stripped!==raw){
  const found=index.normalized.get(normalizeKey(stripped));
  if(found!==undefined)return found;
 }
 return index.normalized.get(normalizeKey(raw));
}
export function renderSkillDescription(skill){
 if(!skill)return '';
 const index=blackboardIndex(skill.blackboard);
 // 前导 "+"/"-" 属于字面显示，不并入键名
 return plainText(skill.description).replace(/\{([+-]?)([^}:]+)(?::([^}]+))?\}/g,(all,sign,key,format)=>{
  const value=blackboardValue(index,key);
  if(value===undefined)return '—';
  const signed=sign==='-';
  if(format?.includes('%')&&Number.isFinite(Number(value))){
   const number=Number(value);
   // 带前导「-」的占位符表示“降低”，前缀负号是字面显示，需保留。黑板值有两种存法：
   //   已是负数（塞雷娅「钙质化」demkni_s_3.move_speed=-0.6）→ 取绝对值
   //   仍是剩余比例（初雪「自然震慑」def=0.6 即降低 40%）→ 取补数
   // 不带符号时按原值显示（角峰「抗寒体质」def=0.1 → +10%）。
   const shown=!signed?Math.round(number*100):(number<0?Math.round(-number*100):Math.round((1-number)*100));
   return (signed?'-':'')+String(shown)+'%';
  }
  // 非百分比或非数值（如 valueStr 文本）按原样输出
  return sign+String(value);
 });
}
