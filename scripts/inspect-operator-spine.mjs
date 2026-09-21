import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {sha256} from './operator-animation-db.mjs';

// Acquisition-time inspector only; never bundled or shipped as game code.
export const INSPECTOR={
  commit:'8b4844bd4b193ba9e54487ed397a777993cbad56',
  sha256:'f1e0a31b9906e4d4daf2733857d21381ddbbe75adec7f4d83e1cc9b2b070dfc1',
  url:'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts/build/spine-core.js',
  license:'https://github.com/EsotericSoftware/spine-runtimes/blob/8b4844bd4b193ba9e54487ed397a777993cbad56/LICENSE'
};
export async function loadSpineInspector({offline=false,request=fetch}={}) {
  const file='artifacts/research/spine-core-'+INSPECTOR.commit+'.js';let bytes;
  try{bytes=await fs.readFile(file);}catch(e){
    if(e.code!=='ENOENT'||offline)throw e;
    const response=await request(INSPECTOR.url);if(!response.ok)throw Error('Inspector HTTP '+response.status);
    bytes=Buffer.from(await response.arrayBuffer());
    if(sha256(bytes)!==INSPECTOR.sha256)throw Error('Inspector integrity mismatch');
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
  }
  if(sha256(bytes)!==INSPECTOR.sha256)throw Error('Inspector integrity mismatch');
  const context=vm.createContext({});vm.runInContext(bytes.toString('utf8'),context,{timeout:10000});
  const spine=context.spine;
  return (skeleton,atlasText,dimensions)=>{
    const atlas=new spine.TextureAtlas(atlasText,name=>{
      const size=dimensions[name];if(!size)throw Error('Atlas texture missing: '+name);
      return {setFilters(){},setWraps(){},getImage(){return size;}};
    });
    const data=new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(skeleton));
    if(!data.version.startsWith('3.8.'))throw Error('Unsupported Spine version: '+data.version);
    return {spineVersion:data.version,bounds:{x:data.x,y:data.y,width:data.width,height:data.height},skins:Array.from(data.skins,s=>s.name),animations:Array.from(data.animations,a=>({name:a.name,duration:Math.round(a.duration*1e6)/1e6}))};
  };
}
