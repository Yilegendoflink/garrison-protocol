import fs from 'node:fs/promises';
import {resolveChess,resolveActiveTalents} from '../dist/protocol.js';

const root='data/modes/alliance-lower/';
const scope=JSON.parse(await fs.readFile(root+'operator-scope.json','utf8'));
const source=JSON.parse(await fs.readFile(root+'source.json','utf8'));
const base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8'));
const audit=JSON.parse(await fs.readFile(root+'operator-behavior-audit.json','utf8'));

function pack(chessId){
 const row=resolveChess(source,base,chessId);
 const shop=source.season.charShopChessDatas[row.normalId];
 const entity=base.entities[shop.tmplId||shop.charId];
 return {
  chessId,
  isGolden:row.isGolden,
  status:row.status,
  skillIndex:row.skillIndex,
  skillId:row.skillId,
  skillUnlockCond:(entity.skillRefs||[]).map(r=>({skillId:r.skillId,unlockCond:r.unlockCond||null})),
  moduleId:row.moduleId,
  modulePhase:row.modulePhase?{equipLevel:row.status.equipLevel,uniEquipId:shop.defaultUniEquipId}:null,
  equipLevel:row.status.equipLevel||0,
  activeTalents:(row.activeTalents||[]).map(t=>({name:t.name,slot:t.slot,blackboard:t.blackboard,fromModule:!!t.fromModule}))
 };
}

const operators=scope.operators.map(op=>{
 const entity=base.entities[op.charId];
 return {
  name:op.name,
  charId:op.charId,
  tier:op.tier,
  chessId:op.chessId,
  goldenChessId:op.goldenChessId,
  branch:op.branch,
  normal:pack(op.chessId),
  elite:pack(op.goldenChessId),
  talentSlots:(entity?.talents||[]).length,
  skillRefs:(entity?.skillRefs||[]).map(r=>({skillId:r.skillId,unlockCond:r.unlockCond||null}))
 };
});

const manifest={
 scopeId:scope.scopeId,
 sourceCommit:source.source.commit,
 gameDataCommit:scope.gameDataCommit,
 auditSourceCommit:audit.sourceCommit,
 generatedAt:source.source.retrievedAt,
 operatorCount:operators.length,
 operators
};
await fs.writeFile(root+'unlock-manifest.json',JSON.stringify(manifest,null,2));

console.log(JSON.stringify({operators:operators.length,commit:source.source.commit}));
