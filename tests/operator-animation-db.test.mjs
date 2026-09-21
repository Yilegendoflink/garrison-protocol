import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ANIMATION_ROOT,readJson,validatePack,verifyFiles,localPath,createAnimationCatalog,resolveAnimation,candidateBindings} from '../scripts/operator-animation-db.mjs';

const exampleFile=ANIMATION_ROOT+'/custom/example/database.json';
const example=await readJson(exampleFile);
test('自制逐帧动画可以独立校验，无需原作 gameId 或技能 ID',async()=>{
  assert.deepEqual(validatePack(example),[]);
  assert.deepEqual((await verifyFiles(example,path.dirname(exampleFile))).errors,[]);
  const catalog=createAnimationCatalog([example]),request={packId:example.id,operatorId:'clockwork'};
  assert.equal(resolveAnimation(catalog,{...request,state:'attack'}).animation.name,'swing');
  assert.equal(resolveAnimation(catalog,{...request,skillId:'clockwork:overdrive',state:'start'}).animation.name,'swing');
  assert.equal(resolveAnimation(catalog,{...request,skillId:'missing',state:'attack'}),null);
  assert.equal(resolveAnimation(catalog,{...request,view:'back'}),null);
});
test('包命名空间隔离同名干员；重复包拒绝覆盖',()=>{
  const second=structuredClone(example);second.id='custom:another';second.operators[0].name='另一个作者';
  const catalog=createAnimationCatalog([example,second]);
  assert.equal(catalog.get(example.id).get('clockwork').name,example.operators[0].name);
  assert.equal(catalog.get(second.id).get('clockwork').name,'另一个作者');
  assert.throws(()=>createAnimationCatalog([example,example]),/Duplicate pack/);
});
test('PRTS 名称匹配只是候选，默认不当成已验证状态，也不猜技能',()=>{
  const copy=structuredClone(example),model=copy.operators[0].models.front;
  model.animations=[{name:'Idle',frames:[0],fps:1,duration:1},{name:'Skill_03_Loop',frames:[1],fps:1,duration:1}];
  model.bindings=candidateBindings(model.animations);
  const catalog=createAnimationCatalog([copy]),query={packId:copy.id,operatorId:'clockwork'};
  assert.equal(resolveAnimation(catalog,query),null);
  assert.equal(resolveAnimation(catalog,{...query,allowCandidates:true}).animation.name,'Idle');
  assert.deepEqual(model.bindings.skills,{});
});
test('拒绝越界路径、悬空动作、无效帧与错误时长',()=>{
  for(const file of ['../escape.png','/absolute.png','C:/escape.png','a\\b.png','https://example.org/x.png','a/%2e%2e/x.png','a//x.png'])assert.throws(()=>localPath('.',file),/Invalid|outside/);
  for(const mutate of [
    m=>m.bindings.states.attack.animation='missing',
    m=>m.animations[1].frames=[2],
    m=>m.animations[1].fps=0,
    m=>m.animations[1].duration=99,
    m=>m.image.file='../escape.png',
    m=>m.bindings.states.attack.hitTime=20,
    m=>m.image.width=63,
    m=>m.image.sha256='broken'
  ]){const copy=structuredClone(example);mutate(copy.operators[0].models.front);assert.ok(validatePack(copy).length);}
  assert.ok(validatePack(null).length);
  assert.ok(validatePack({...example,operators:{}}).length);
});
test('资源篡改与尺寸伪报会被离线检查发现',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'operator-animation-test-'));
  try {
    const image=await fs.readFile(path.dirname(exampleFile)+'/clockwork.png');
    await fs.writeFile(path.join(root,'clockwork.png'),image);
    const copy=structuredClone(example);copy.operators[0].models.front.image.width=128;
    assert.ok((await verifyFiles(copy,root)).errors.some(e=>e.includes('dimensions')));
    image[image.length-1]^=1;await fs.writeFile(path.join(root,'clockwork.png'),image);
    assert.ok((await verifyFiles(example,root)).errors.some(e=>e.includes('mismatch')));
  }finally{await fs.unlink(path.join(root,'clockwork.png')).catch(()=>{});await fs.rmdir(root);}
});
test('已采集数据库与固定 inventory 一一对应，并保留真实动作与独立技能映射',async()=>{
  const {snapshot}=await readJson(ANIMATION_ROOT+'/prts/latest.json');
  const root=localPath(ANIMATION_ROOT+'/prts',snapshot),pack=await readJson(root+'/database.json'),inventory=await readJson(root+'/inventory.json');
  assert.deepEqual(validatePack(pack),[]);
  assert.deepEqual(pack.operators.map(o=>o.id),inventory.operators.map(o=>o.id));
  assert.ok(pack.operators.every(o=>o.id.startsWith('char_')));
  const blaze=pack.operators.find(o=>o.id==='char_1040_blaze2').models.front;
  assert.ok(blaze.animations.some(a=>a.name==='Skill_3_Begin'&&a.duration>0));
  assert.deepEqual(blaze.bindings.skills,{});
  assert.equal(blaze.visualVerified,false);
  const skadi=pack.operators.find(o=>o.id==='char_1012_skadi2');
  assert.equal(skadi.models.front.sourceLabel,'战斗');
  assert.equal(skadi.models.back,undefined);
  assert.doesNotThrow(()=>createAnimationCatalog([pack,example]));
});
