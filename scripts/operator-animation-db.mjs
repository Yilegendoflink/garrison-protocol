import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const ANIMATION_ROOT = 'data/operator-animations';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  await fs.writeFile(file+'.tmp', JSON.stringify(value,null,2)+'\n');
  await fs.rename(file+'.tmp',file);
}
export const readJson = file => fs.readFile(file,'utf8').then(JSON.parse);
export function localPath(root, file) {
  if(typeof file!=='string'||!file||file.includes('\\')||file.split('/').some(s=>!s||s==='.'||s==='..')||/[:?#%\x00-\x1f]/.test(file)||path.isAbsolute(file))throw Error('Invalid asset path: '+file);
  const target=path.resolve(root,file),base=path.resolve(root);
  if(!target.startsWith(base+path.sep))throw Error('Asset outside pack: '+file);
  return target;
}
export function modelResources(model) {
  return model.format==='spine'?[model.skeleton,model.atlas,...(model.textures||[])]:[model.image];
}
export function candidateBindings(animations) {
  const names=new Set(animations.map(a=>a.name)),states={};
  for(const [state,name,loop] of [['idle','Idle',true],['attack','Attack',false],['deploy','Start',false],['die','Die',false],['move','Move_Loop',true],['stun','Stun',true]]) {
    if(names.has(name))states[state]={animation:name,loop,status:'candidate',evidence:'Exact animation name only; gameplay meaning and timing not verified'};
  }
  return {states,skills:{}};
}

// Data only: a pack never contains executable handlers or imports game rules.
export function validatePack(pack) {
  const errors=[],check=(ok,message)=>{if(!ok)errors.push(message);};
  const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$/.test(v);
  check(pack?.schemaVersion===1,'schemaVersion must be 1');
  check(id(pack?.id),'Invalid pack id');
  check(['prts','custom'].includes(pack?.provider),'Invalid provider');
  check(Array.isArray(pack?.operators)&&pack.operators.length>0,'operators must be nonempty');
  const ids=new Set();
  for(const op of Array.isArray(pack?.operators)?pack.operators:[]) {
    if(!op||typeof op!=='object'){errors.push('Invalid operator record');continue;}
    check(id(op.id)&&!ids.has(op.id),'Invalid/duplicate operator id: '+op.id);ids.add(op.id);
    check(typeof op.name==='string'&&!!op.name,'Missing operator name: '+op.id);
    check(op.models?.front,'Missing front model: '+op.id);
    for(const [view,m] of Object.entries(op.models||{})) {
      const key=op.id+'/'+view;
      if(!m||typeof m!=='object'){errors.push('Invalid model: '+key);continue;}
      check(['front','back'].includes(view),'Unsupported view: '+key);
      check(['spine','spritesheet'].includes(m.format),'Unsupported format: '+key);
      const names=new Set();
      check(Array.isArray(m.animations)&&m.animations.length>0,'No animations: '+key);
      for(const a of Array.isArray(m.animations)?m.animations:[]) {
        if(!a||typeof a!=='object'){errors.push('Invalid animation: '+key);continue;}
        check(typeof a.name==='string'&&a.name.length>0&&!names.has(a.name),'Invalid/duplicate animation: '+key);names.add(a.name);
        check(Number.isFinite(a.duration)&&a.duration>=0,'Invalid duration: '+key+'/'+a.name);
        if(m.format==='spritesheet') {
          const cols=Math.floor(m.image?.width/m.frameWidth),rows=Math.floor(m.image?.height/m.frameHeight);
          check(Array.isArray(a.frames)&&a.frames.length>0&&a.frames.every(f=>Number.isInteger(f)&&f>=0&&f<cols*rows),'Invalid frames: '+key+'/'+a.name);
          check(Number.isFinite(a.fps)&&a.fps>0&&Math.abs(a.duration-a.frames?.length/a.fps)<1e-6,'Invalid sprite timing: '+key+'/'+a.name);
        }
      }
      if(m.format==='spine') {
        check(typeof m.spineVersion==='string'&&/^\d+\.\d+/.test(m.spineVersion),'Missing Spine version: '+key);
        check(Array.isArray(m.textures)&&m.textures.length>0,'Missing textures: '+key);
        check(/\.(skel|json)$/.test(m.skeleton?.file||''),'Invalid skeleton extension: '+key);
        check(/\.atlas$/.test(m.atlas?.file||''),'Invalid atlas extension: '+key);
      } else {
        check(Number.isInteger(m.frameWidth)&&m.frameWidth>0&&Number.isInteger(m.frameHeight)&&m.frameHeight>0,'Invalid frame dimensions: '+key);
        check(Number.isInteger(m.image?.width)&&m.image.width>0&&Number.isInteger(m.image?.height)&&m.image.height>0,'Invalid image dimensions: '+key);
        check(m.image?.width%m.frameWidth===0&&m.image?.height%m.frameHeight===0,'Incomplete sprite cells: '+key);
      }
      for(const r of modelResources(m)) {
        try{localPath('.',r?.file);}catch(e){errors.push(key+': '+e.message);}
        check(typeof r?.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256),'Invalid asset hash: '+key);
        check(Number.isSafeInteger(r?.bytes)&&r.bytes>0,'Invalid asset size: '+key);
      }
      for(const r of (m.format==='spine'?m.textures||[]:[m.image]))check(/\.(png|webp)$/.test(r?.file||''),'Texture must be PNG/WebP: '+key);
      const bindings=m.bindings;
      check(bindings&&typeof bindings.states==='object'&&typeof bindings.skills==='object','Missing bindings: '+key);
      const groups=[bindings?.states||{},...Object.values(bindings?.skills||{})];
      for(const group of groups)for(const [state,b] of Object.entries(group||{})) {
        check(b&&names.has(b.animation),'Unknown animation binding: '+key+'/'+state);
        check(typeof b?.loop==='boolean','Missing loop flag: '+key+'/'+state);
        check(['candidate','confirmed'].includes(b?.status),'Invalid binding status: '+key+'/'+state);
        if(b?.hitTime!==undefined)check(Number.isFinite(b.hitTime)&&b.hitTime>=0&&b.hitTime<=(Array.isArray(m.animations)?m.animations.find(a=>a?.name===b.animation)?.duration??-1:-1),'Invalid visual hitTime: '+key+'/'+state);
      }
    }
  }
  return errors;
}
export async function verifyFiles(pack, root) {
  const errors=[],seen=new Map();
  for(const op of pack.operators)for(const model of Object.values(op.models))for(const r of modelResources(model)) {
    const signature=r.sha256+':'+r.bytes,previous=seen.get(r.file);
    if(previous){if(previous!==signature)errors.push('Conflicting asset: '+r.file);continue;}
    seen.set(r.file,signature);
    try {
      const target=localPath(root,r.file),real=await fs.realpath(target),base=await fs.realpath(root);
      if(!real.startsWith(base+path.sep))throw Error('Symlink outside pack');
      const bytes=await fs.readFile(target);
      if(bytes.length!==r.bytes||sha256(bytes)!==r.sha256)errors.push('Asset mismatch: '+r.file);
      if(r.file.endsWith('.png')) {
        if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')errors.push('Invalid PNG: '+r.file);
        else if((r.width!==undefined&&r.width!==bytes.readUInt32BE(16))||(r.height!==undefined&&r.height!==bytes.readUInt32BE(20)))errors.push('PNG dimensions mismatch: '+r.file);
      }
    } catch(e){errors.push(r.file+': '+e.message);}
  }
  return {files:seen.size,errors};
}
export function createAnimationCatalog(packs) {
  const catalog=new Map();
  for(const pack of packs) {
    const errors=validatePack(pack);if(errors.length)throw Error(errors.join('\n'));
    if(catalog.has(pack.id))throw Error('Duplicate pack id: '+pack.id);
    catalog.set(pack.id,new Map(pack.operators.map(op=>[op.id,op])));
  }
  return catalog;
}
export function resolveAnimation(catalog,{packId,operatorId,view='front',state='idle',skillId=null,allowCandidates=false}) {
  const model=catalog.get(packId)?.get(operatorId)?.models[view];
  const binding=skillId?model?.bindings.skills[skillId]?.[state]:model?.bindings.states[state];
  if(!binding||(!allowCandidates&&binding.status!=='confirmed'))return null;
  return {model,binding,animation:model.animations.find(a=>a.name===binding.animation)};
}
