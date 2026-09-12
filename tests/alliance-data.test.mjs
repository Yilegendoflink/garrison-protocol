import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
const root='data/modes/alliance-lower/',source=JSON.parse(fs.readFileSync(root+'source.json')),manifest=JSON.parse(fs.readFileSync(root+'levels/manifest.json'));
test('all native mode wave and battlefield references have pinned intact local sources',()=>{
 const ids=new Set(Object.values(source.season.battleDataDict).flatMap(rounds=>Object.values(rounds).flatMap(bs=>bs.map(b=>b.levelId.toLowerCase()))));for(const s of Object.values(source.season.stageDatasDict))ids.add('activities/'+s.stageId.split('_')[0]+'/level_'+s.stageId);assert.equal(Object.keys(manifest.files).length,50);assert.equal(manifest.commit,source.source.commit);
 for(const id of ids)assert.ok(manifest.files[id],id);for(const entry of Object.values(manifest.files)){const bytes=fs.readFileSync(root+'levels/'+entry.file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);assert.ok(entry.url.includes(source.source.commit));JSON.parse(bytes);}
});
