import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {RANDOM_MAP_ID,selectableMaps,resolveMapId} from '../dist/protocol.js';
import {renderLobby} from '../dist/native-lobby.js';
import {NativeSession} from '../dist/native-session.js';
import {waveRng} from '../dist/native-wave-random.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 随机地图（用户 2026-09-22 口径）：大厅「作战阵地」下拉多一项哨兵「随机地图」并且是默认；
// 开局时按本局种子抽一个具体阵地写进 draft／会话，之后所有流程只看到具体阵地。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');
const avatar=()=>'<img alt="">';
const lobbyWith=map=>renderLobby({data,state:{mode:'mode_single_normal',map,game:null},avatar});

test('随机地图哨兵：默认值、等概率抽一个可用阵地、同种子结果固定',()=>{
 const list=selectableMaps(data);
 assert.equal(RANDOM_MAP_ID,'random');
 assert.equal(list.length,data.maps.filter(m=>m.weight>0).length);
 assert.ok(list.length>=8,'本期至少 8 个可选阵地');
 assert.ok(list.every(m=>m.weight>0));
 // 抽的是 [0,1) 上的等分区间。
 assert.equal(resolveMapId(data,RANDOM_MAP_ID,()=>0),list[0].stageId);
 assert.equal(resolveMapId(data,RANDOM_MAP_ID,()=>0.999999),list.at(-1).stageId);
 assert.equal(resolveMapId(data,RANDOM_MAP_ID,()=>0.5),list[Math.floor(0.5*list.length)].stageId);
 // 空值／undefined 也当随机处理（老状态里没有 map 字段时不该崩）。
 assert.equal(resolveMapId(data,undefined,()=>0),list[0].stageId);
 assert.equal(resolveMapId(data,'',()=>0.999999),list.at(-1).stageId);
 // 具体阵地原样返回（包括已经下架的 id，让 NativeSession 自己去回落）。
 assert.equal(resolveMapId(data,list[2].stageId,()=>0.9),list[2].stageId);
 assert.equal(resolveMapId(data,'not-a-map',()=>0.9),'not-a-map');
 // 同一种子结果固定，且 60 个种子能覆盖到全部阵地。
 const pick=seed=>resolveMapId(data,RANDOM_MAP_ID,waveRng((seed^0x9e3779b9)>>>0));
 const seeds=Array.from({length:60},(_,i)=>i);
 for(const seed of seeds)assert.equal(pick(seed),pick(seed),'同种子必须抽到同一张图');
 assert.deepEqual([...new Set(seeds.map(pick))].sort(),list.map(m=>m.stageId).sort(),'所有可用阵地都要有机会被抽到');
});

test('大厅阵地下拉：第一项是随机地图且默认选中，选具体阵地时它不选中',()=>{
 const selectOf=html=>{const start=html.indexOf('id="native-map"');return html.slice(start,html.indexOf('</select>',start));};
 const selectedValues=html=>[...selectOf(html).matchAll(/<option value="([^"]+)"([^>]*)>/g)].filter(m=>/selected/.test(m[2])).map(m=>m[1]);
 const randomSelect=selectOf(lobbyWith(RANDOM_MAP_ID));
 assert.match(randomSelect,/^id="native-map"><option value="random"/,'随机地图要是下拉的第一项');
 assert.deepEqual(selectedValues(lobbyWith(RANDOM_MAP_ID)),[RANDOM_MAP_ID],'默认只选中「随机地图」');
 for(const m of selectableMaps(data))assert.ok(randomSelect.includes(`value="${m.stageId}"`),`下拉里要保留具体阵地 ${m.stageId}`);
 const concrete=selectableMaps(data)[3].stageId;
 assert.deepEqual(selectedValues(lobbyWith(concrete)),[concrete],'选了具体阵地就只有它选中');
});

test('开局接线：默认哨兵、按种子解析、会话与沙盒都拿到具体阵地',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/map:RANDOM_MAP_ID,/,'state.map 默认是随机地图哨兵');
 assert.match(play,/const banConfig=loadBondBan\(data\),mapId=resolveMapId\(data,state\.map,waveRng\(\(seed\^0x9e3779b9\)>>>0\)\);state\.draft=\{modeId,mapId,seed,/,'开局时按本局种子把哨兵解析成具体阵地');
 assert.match(play,/mapId:resolveMapId\(data,state\.map\),seed:1/,'技能测试场也要解析哨兵，不能把 random 传给会话');
 // 行为验证：解析出来的阵地真的能起一局，且同种子可复现。
 const first=pickFor(1),second=pickFor(1);
 assert.equal(first,second);
 const g=new NativeSession(data,{bondBan:NO_BOND_BAN,mapId:first,seed:1});
 assert.equal(g.map.stageId,first);
 assert.ok(g.map.weight>0,'拿到的必须是可用阵地');
 assert.equal(g.s.mapId,first);
});

function pickFor(seed){return resolveMapId(data,RANDOM_MAP_ID,waveRng((seed^0x9e3779b9)>>>0));}
