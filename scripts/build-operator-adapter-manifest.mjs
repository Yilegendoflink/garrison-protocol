import fs from 'node:fs/promises';
const root='data/modes/alliance-lower/';
const scope=JSON.parse(await fs.readFile(root+'operator-scope.json','utf8'));
const data=JSON.parse(await fs.readFile(root+'operator-behavior-audit.json','utf8'));
const unresolved=/缺失|未接入|不完整|待实现|另需|仍需/;
const operators=scope.operators.map(op=>{
 const audit=data.operators.find(x=>x.name===op.name);
 return {name:op.name,charId:op.charId,tier:op.tier,chessId:op.chessId,goldenChessId:op.goldenChessId,adapter:'descriptor-v1',skillAdapter:'generic-blackboard-and-description',talentAdapter:'generic-event-and-direct-stat',needsSpecialHandler:Boolean(unresolved.test(audit?.skillGaps||'')||unresolved.test(audit?.talentGaps||''))};
});
await fs.writeFile(root+'operator-adapter-manifest.json',JSON.stringify({scopeId:scope.scopeId,version:1,generatedFrom:'dist/native-operator-effects.js',operators},null,2)+'\n');
console.log(JSON.stringify({operators:operators.length,specialHandlers:operators.filter(x=>x.needsSpecialHandler).length}));
