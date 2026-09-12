import fs from 'node:fs';

const report=JSON.parse(fs.readFileSync('data/modes/alliance-lower/readiness.json','utf8'));
const blockers=[];
if(report.s6?.acceptedScopeComplete!==true)blockers.push('用户约定的 S06 范围（最终阶段木桩替代）尚未验收通过');
for(const phase of ['s4','s5']){
 if(!Array.isArray(report[phase]?.pending))blockers.push(phase+' 缺少待完成项清单');
 else if(report[phase].pending.length)blockers.push(phase+' 仍有 '+report[phase].pending.length+' 项未完成');
}
if(!Array.isArray(report.dataReferences)||report.dataReferences.length)blockers.push('内容引用校验尚未通过');
if(blockers.length){console.error('禁止发布：\n'+blockers.map(s=>' - '+s).join('\n'));process.exitCode=1;}
else console.log('S06 报告满足发布条件；仍须完成本次发布的浏览器与原作对照验收。');
