import {VERSION,OP,OPERATORS,EQ,EQUIPMENT,SP,SPELLS,STRATEGIES,DECISIONS,MAPS,ALLIANCES,ENEMIES,WAVES,DIFFICULTIES} from './data.js';
export const LEGACY_CONTENT={id:'legacy:garrison-v2',version:5,finalPhase:{kind:'training-dummy',duration:150},deploymentDelay:3,purchasePrices:{1:2,2:3,3:3,4:3,5:4,6:4},startingShop:['fang','melantha','beagle'],VERSION,OP,OPERATORS,EQ,EQUIPMENT,SP,SPELLS,STRATEGIES,DECISIONS,MAPS,ALLIANCES,ENEMIES,WAVES,DIFFICULTIES};
export function validateContent(content){
 const errors=[];if(!content||typeof content.id!=='string'||!content.id||!Number.isInteger(content.version))return ['内容包ID或版本无效'];
 for(const key of ['OP','EQ','SP','ALLIANCES','ENEMIES','DIFFICULTIES'])if(!content[key]||typeof content[key]!=='object')errors.push('缺少数据表 '+key);
 for(const key of ['OPERATORS','EQUIPMENT','SPELLS','STRATEGIES','DECISIONS','MAPS','WAVES'])if(!Array.isArray(content[key]))errors.push('缺少数据列表 '+key);
 if(errors.length)return errors;
 if(!content.STRATEGIES.length||!content.MAPS.length||!content.WAVES.length||!Object.keys(content.DIFFICULTIES).length)errors.push('基础模式配置不能为空');
 for(const id of content.startingShop||[])if(!content.OP[id])errors.push('初始商店干员不存在 '+id);
 const ids=new Set();for(const o of content.OPERATORS){if(!o.id||ids.has(o.id))errors.push('重复干员ID '+o.id);ids.add(o.id);if(content.OP[o.id]!==o)errors.push('干员索引不一致 '+o.id);for(const k of ['hp','atk','def','res','interval','redeploy','dp'])if(!Number.isFinite(o[k])||o[k]<0)errors.push(o.id+' 无效属性 '+k);if(!Array.isArray(o.skills)||!o.skills.length)errors.push(o.id+' 缺少演示技能');for(const a of o.alliances||[])if(!content.ALLIANCES[a])errors.push(o.id+' 缺少盟约 '+a);}
 for(const wave of content.WAVES)if(!content.ENEMIES[wave[1]])errors.push('波次敌人不存在 '+wave[1]);
 for(const map of content.MAPS){if(!Number.isInteger(map.cols)||!Number.isInteger(map.rows)||map.cols<1||map.rows<1)errors.push('地图尺寸无效');for(const route of map.paths||[]){if(route.length<2)errors.push('路径过短');for(const p of route)if(!Array.isArray(p)||p.length!==2||!p.every(Number.isInteger)||p[0]<0||p[1]<0||p[0]>=map.cols||p[1]>=map.rows)errors.push('路径坐标越界 '+map.id);}}
 return errors;
}
export function loadContentPack(document){
 const content=JSON.parse(JSON.stringify(document));
 content.OP=Object.fromEntries((content.OPERATORS||[]).map(o=>[o.id,o]));content.EQ=Object.fromEntries((content.EQUIPMENT||[]).map(o=>[o.id,o]));content.SP=Object.fromEntries((content.SPELLS||[]).map(o=>[o.id,o]));
 const errors=validateContent(content);if(errors.length)throw Error(errors.join('; '));return content;
}
