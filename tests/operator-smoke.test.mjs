import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {openBattle,deployNow} from './effects-harness.mjs';

const scope=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-scope.json','utf8'));

test('all fixed operators and all listed skills enter the native adapter without runtime errors',()=>{
 let skills=0;
 for(const op of scope.operators){
  assert.ok(Object.values(NATIVE_DATA.profiles).some(p=>p.charId===op.charId),op.name);
  for(let skillIndex=0;skillIndex<3;skillIndex++){
   const profile=NATIVE_DATA.profiles[op.goldenChessId]||NATIVE_DATA.profiles[op.chessId],choice=profile?.skillChoices?.[skillIndex];
   if(!choice?.skill)continue;
   const {b}=openBattle({chessId:op.goldenChessId,skillIndex});deployNow(b);const u=b.s.units[0];
   u.sp=Math.max(b.spCost(u),1e6);
   assert.doesNotThrow(()=>b.activate(u),`${op.name} S${skillIndex+1}`);skills++;
  }
 }
 assert.equal(skills,283);
});
