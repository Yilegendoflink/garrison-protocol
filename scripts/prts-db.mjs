import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('data/prts'),latest=JSON.parse(await fs.readFile(path.join(root,'latest.json'),'utf8'));
if(!/^[\w-]+$/.test(latest.snapshot))throw Error('Invalid snapshot pointer');
const dir=path.join(root,'snapshots',latest.snapshot);
const read=name=>fs.readFile(path.join(dir,name),'utf8').then(JSON.parse);
const tables={operator:'operators.json',enemy:'enemies.json',summon:'summons.json',range:'ranges.json'};
const [command='stats',kind,query]=process.argv.slice(2);
if(command==='stats')console.log(JSON.stringify(await read('coverage.json'),null,2));
else if(command==='search'||command==='show'){
 if(!tables[kind]||!query)throw Error('Usage: node scripts/prts-db.mjs '+command+' operator|enemy|summon|range NAME_OR_ID');
 const records=await read(tables[kind]);
 const rows=records.filter(r=>[r.id,r.name,r.gameId,r.codexId].some(v=>v&&(command==='show'?v===query:v.toLocaleLowerCase().includes(query.toLocaleLowerCase()))));
 if(command==='show'&&rows.length!==1)throw Error('Expected one exact match, found '+rows.length+'; use the stable ID');
 console.log(JSON.stringify(command==='show'?rows[0]:rows.map(r=>({id:r.id,name:r.name,gameId:r.gameId,codexId:r.codexId})),null,2));
}else if(command==='validate'){
 const manifest=await read('manifest.json'),inventory=await read('inventory.json');const errors=[];
 for(const [p,expected]of Object.entries({...manifest.files,...manifest.sourceFiles})){const target=path.resolve(dir,p);if(!target.startsWith(dir+path.sep))throw Error('Invalid manifest path');const actual=crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');if(actual!==expected)errors.push('hash '+p);}
 const pageIds=new Set(inventory.pages.map(p=>p.pageid));if(pageIds.size!==inventory.pages.length)errors.push('duplicate page IDs');
 for(const [kind,file]of Object.entries(tables)){const rows=await read(file);if(new Set(rows.map(r=>r.id)).size!==rows.length)errors.push('duplicate '+kind+' IDs');
  if(kind!=='range')for(const r of rows){const pageId=r.source?.pageId||r.pageId;if(!pageIds.has(pageId))errors.push('missing source '+r.id);if(kind==='enemy'&&new Set(r.levels.map(l=>l.level)).size!==r.levels.length)errors.push('duplicate enemy levels '+r.id);}
 }
 let sqliteChecked=false;try{const metadata=await read('database.sqlite.metadata.json');sqliteChecked=true;const digest=async name=>crypto.createHash('sha256').update(await fs.readFile(path.join(dir,name))).digest('hex');if(await digest('manifest.json')!==metadata.sourceManifestHash)errors.push('SQLite export uses a different manifest');if(await digest('database.sqlite')!==metadata.sqliteHash)errors.push('SQLite file hash mismatch');}catch(error){if(error.code!=='ENOENT')throw error;}
 const operatorCount=inventory.pages.filter(p=>p.categories.includes('干员')||p.categories.includes('专属干员')).length;
 if((await read('operators.json')).length!==operatorCount)errors.push('operator inventory mismatch');
 if((await read('enemies.json')).length!==inventory.counts['敌人'])errors.push('enemy inventory mismatch');
 if((await read('summons.json')).length!==inventory.counts['召唤物'])errors.push('summon inventory mismatch');
 console.log(JSON.stringify({valid:!errors.length,sqliteChecked,filesChecked:Object.keys(manifest.files).length+Object.keys(manifest.sourceFiles).length,errors,coverage:(await read('coverage.json')).collected},null,2));if(errors.length)process.exitCode=1;
}else if(command==='sqlite'){
 // Optional query export. JSON remains the canonical, browser-portable database.
 const {DatabaseSync}=await import('node:sqlite');const target=path.join(dir,'database.sqlite'),temp=target+'.tmp';await fs.rm(temp,{force:true});const db=new DatabaseSync(temp);
 try{
 db.exec('PRAGMA foreign_keys=ON; CREATE TABLE operators(id TEXT PRIMARY KEY,name TEXT NOT NULL,game_id TEXT,rarity INTEGER,profession TEXT,branch TEXT,revision_id INTEGER,data TEXT NOT NULL); CREATE TABLE skills(id TEXT PRIMARY KEY,operator_id TEXT REFERENCES operators(id),name TEXT,recovery TEXT,activation TEXT,data TEXT NOT NULL); CREATE TABLE skill_levels(skill_id TEXT REFERENCES skills(id),level TEXT,initial_sp REAL,cost REAL,duration REAL,data TEXT NOT NULL,PRIMARY KEY(skill_id,level)); CREATE TABLE modules(operator_id TEXT REFERENCES operators(id),ordinal INTEGER,name TEXT,kind TEXT,data TEXT NOT NULL,PRIMARY KEY(operator_id,ordinal)); CREATE TABLE enemies(id TEXT PRIMARY KEY,name TEXT NOT NULL,codex_id TEXT,rank TEXT,revision_id INTEGER,data TEXT NOT NULL); CREATE TABLE enemy_levels(enemy_id TEXT REFERENCES enemies(id),level INTEGER,max_hp REAL,attack REAL,defense REAL,resistance REAL,data TEXT NOT NULL,PRIMARY KEY(enemy_id,level)); CREATE TABLE summons(id TEXT PRIMARY KEY,name TEXT,data TEXT NOT NULL); CREATE TABLE ranges(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); BEGIN;');
 const op=db.prepare('INSERT INTO operators VALUES(?,?,?,?,?,?,?,?)'),skill=db.prepare('INSERT INTO skills VALUES(?,?,?,?,?,?)'),sl=db.prepare('INSERT INTO skill_levels VALUES(?,?,?,?,?,?)'),mod=db.prepare('INSERT INTO modules VALUES(?,?,?,?,?)');
 for(const o of await read('operators.json')){op.run(o.id,o.name,o.gameId,o.rarity,o.profession,o.branch,o.source.revisionId,JSON.stringify(o));for(const s of o.skills){skill.run(s.id,o.id,s.name,s.recovery,s.activation,JSON.stringify(s));for(const l of s.levels)sl.run(s.id,l.level,l.initialSP,l.cost,l.duration,JSON.stringify(l));}o.modules.forEach((m,i)=>mod.run(o.id,i,m.fields['名称']||null,m.fields['基础证章']==='yes'?'badge':'upgrade',JSON.stringify(m)));}
 const enemy=db.prepare('INSERT INTO enemies VALUES(?,?,?,?,?,?)'),el=db.prepare('INSERT INTO enemy_levels VALUES(?,?,?,?,?,?,?)');
 for(const e of await read('enemies.json')){enemy.run(e.id,e.name,e.codexId,e.rank,e.source.revisionId,JSON.stringify(e));for(const l of e.levels)el.run(e.id,l.level,l.stats.maxHp,l.stats.attack,l.stats.defense,l.stats.resistance,JSON.stringify(l));}
 for(const kind of ['summon','range']){const table=kind==='summon'?'summons':'ranges',insert=db.prepare(kind==='summon'?'INSERT INTO summons VALUES(?,?,?)':'INSERT INTO ranges VALUES(?,?)');for(const r of await read(tables[kind]))kind==='summon'?insert.run(r.id,r.name,JSON.stringify(r)):insert.run(r.id,JSON.stringify(r));}
 db.prepare('INSERT INTO metadata VALUES(?,?)').run('manifest',JSON.stringify(await read('manifest.json')));db.exec('COMMIT; CREATE INDEX operator_name ON operators(name); CREATE INDEX enemy_name ON enemies(name);');
 const integrity=db.prepare('PRAGMA integrity_check').get();if(Object.values(integrity)[0]!=='ok')throw Error(JSON.stringify(integrity));if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key errors');
 console.log(JSON.stringify({file:target,operators:db.prepare('SELECT COUNT(*) AS n FROM operators').get().n,enemies:db.prepare('SELECT COUNT(*) AS n FROM enemies').get().n,integrity:'ok'}));
 }finally{db.close();}
 await fs.rename(temp,target);
 await fs.writeFile(target+'.metadata.json',JSON.stringify({sourceManifestHash:crypto.createHash('sha256').update(await fs.readFile(path.join(dir,'manifest.json'))).digest('hex'),sqliteHash:crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex')},null,2)+'\n');
}else throw Error('Commands: stats, search, show, validate, sqlite');
