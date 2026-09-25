import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {battleTally} from '../dist/protocol.js';
import {applyStatus} from '../dist/status.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 战斗中顶栏（用户 2026-09-22 口径）：左=当前回合，中=击杀敌人/剩余敌人，右=剩余生命值。
// 关键口径：**衍生敌人（解压缩碎片、敌方召唤／分裂／幻影）不计击杀数**，单独记 s.derivedKills，
// s.kills 保持原语义（战报记录、卫戍击倒计数都不受影响）；剩余敌人＝队列未入场 ＋ 待生成 ＋ 场上存活。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');

function liveBattle(){
 const g=new NativeSession(NATIVE_DATA,{seed:23,bondBan:NO_BOND_BAN});
 g.s.funds=100;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden).chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'干员需要落场');
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;
 b.deploy(b.s.units[0]);
 return b;
}
// 碎片按原表在 0.7 秒内随机延迟生成；这段时间先把干员缴械，免得它们顺手把碎片打了。
function flushFragments(b){for(const u of b.s.units)applyStatus(u,'disarm',60);for(let i=0;i<22;i++)b.step();}
function spawnEnemy(b,id,x,y){
 const origin=b.map.origin||{col:0,row:0},spot={col:x+origin.col,row:origin.row-y};
 b.level={...(b.level||{}),routes:[{motionMode:'WALK',startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...(b.level?.enemyProfiles||{}),[id]:NATIVE_DATA.enemies[id]}};
 b.spawn({id,route:0});
 return b.s.enemies.at(-1);
}

test('计数器口径：衍生敌人不计击杀，分母是当轮敌人总数',()=>{
 assert.deepEqual(battleTally({kills:3,derivedKills:1,total:10}),{kills:2,derived:1,total:10});
 assert.deepEqual(battleTally(null),{kills:0,derived:0,total:0},'没有战斗状态时全 0，不能抛错');
 assert.equal(battleTally({kills:4}).kills,4,'没有衍生击杀时就是原始击倒数');
 assert.equal(battleTally({kills:1,derivedKills:5}).kills,0,'衍生击杀多于总击倒时不会出现负数');
});

test('真实战斗：编制敌人算击杀，解压缩碎片不算',()=>{
 const b=liveBattle(),u=b.s.units[0];
 b.s.total=1;
 const parent=spawnEnemy(b,'enemy_1195_sfyin',u.x+1,u.y);
 assert.deepEqual(battleTally(b.s),{kills:0,derived:0,total:1});
 b.hit(u,parent,999999,'physical');
 b.step();
 assert.equal(b.s.kills,1);
 assert.equal(battleTally(b.s).kills,1,'本波编制敌人的击倒要计入计数器');
 assert.equal(battleTally(b.s).total,1,'分母是当轮总数，不随击杀/漏怪变化');
 b.flushEnemySpawns();
 flushFragments(b);
 const fragments=b.s.enemies.filter(e=>e.id==='enemy_1196_msfyin');
 assert.equal(fragments.length,2,'磨砻被击倒后生成 2 个木制瑞印');
 assert.ok(fragments.every(e=>e.derived===true),'解压缩碎片必须带上 derived 标记');
 b.hit(u,fragments[0],99999,'physical');b.hit(u,fragments[0],99999,'physical');
 b.step();
 assert.equal(fragments[0].hp,0);
 assert.equal(b.s.kills,2,'s.kills 保持原语义（碎片照旧计入）');
 assert.equal(b.s.derivedKills,1);
 assert.deepEqual(battleTally(b.s),{kills:1,derived:1,total:1},'碎片不计入计数器，总数也不因衍生敌人变大');
});

test('所有战斗中生成的敌人都标了 derived（漏一个就会虚增击杀数）',async()=>{
 assert.match(await read('native-battle.js'),/queueEnemySpawn\(\{id:spec\.enemyKey,derived:true\}/,'解压缩（DeadSpawn）碎片');
 assert.match(await read('native-enemy-forms.js'),/queueEnemySpawn\(\{id:enemyKey,derived:true\}/,'载客敌人被放出的单位');
 assert.match(await read('native-enemy-skills.js'),/queueEnemySpawn\(\{id:'enemy_2017_csphts',derived:true\}/,'幻影');
 assert.match(await read('native-enemy-skills.js'),/queueEnemySpawn\(\{id:cast\.spawn\.enemyKey,derived:true\}/,'施法召唤');
 assert.match(await read('native-enemy-traits.js'),/queueEnemySpawn\(\{id:spec\.enemyKey,derived:true\}/,'天赋召唤');
 assert.match(await read('native-battle.js'),/bountyReward:q\.bountyReward,derived:!!q\.derived/,'spawn 必须把 derived 带到敌人实例上');
 assert.match(await read('native-effects.js'),/if\(target\.derived\)battle\.s\.derivedKills=/,'击杀时单独记衍生击杀');
 assert.match(await read('native-battle.js'),/leaks:0,kills:0,derivedKills:0/,'战斗状态要初始化 derivedKills');
});

test('计数器在场景窗体的标题行里，三个数值都由 updateHud 刷新',async()=>{
 const play=await read('native-play.js');
 assert.match(play,/<span id="native-wave-progress">\$\{s\.units\.filter\(u=>u\.position\)\.length\} \/ \$\{s\.capacity\} 部署<\/span>\$\{s\.phase==='battle'&&!state\.sandbox\?battleBar\(\):''\}/,'计数器要接在场景窗体标题行（.native-field-caption）末尾，不能放页面顶部那一条');
 assert.doesNotMatch(play,/<\/header>\$\{s\.phase==='battle'/,'不要再把它插在页头和工作区之间');
 for(const id of ['native-bb-round','native-bb-kills','native-bb-total','native-bb-hp'])assert.match(play,new RegExp(`id="${id}"`),id+' 要有落点');
 assert.match(play,/set\('native-bb-round',g\.s\.round\)/,'左＝当前回合');
 assert.match(play,/set\('native-bb-kills',tally\?tally\.kills:0\)/,'中＝击杀敌人');
 assert.match(play,/set\('native-bb-total',tally\?tally\.total:0\)/,'中＝当轮敌人总数');
 assert.match(play,/set\('native-bb-hp',g\.s\.hp\)/,'右＝剩余生命值');
 assert.match(play,/,tally=b\?battleTally\(b\):null/,'与侧栏共用同一份计数（不要各写一套）');
 assert.match(play,/漏失 \$\{b\.leaks\}/,'标题行原有的进度文字改成只报漏失，别再重复击杀数');
});

test('计数器样式：一行紧凑、靠右贴在场景窗体里，手机横屏不显示',async()=>{
 const css=await read('native.css');
 assert.match(css,/\.native-field-caption\{[^}]*display:flex[^}]*flex-wrap:wrap/,'标题行改成可换行的 flex，窄屏时计数器换行而不是压住别人');
 assert.match(css,/\.native-battle-bar\{margin-left:auto[^}]*display:flex/,'计数器靠右且是一行内的紧凑块');
 assert.doesNotMatch(css,/\.native-battle-bar\{[^}]*grid-template-columns/,'不要再做成占满一整行的三段式');
 assert.match(css,/\.native-bb-core\{[^}]*#d0743c/,'中间那块是橙色核心胶囊');
 assert.match(css,/html\.native-landscape-ui \.native-battle-bar\{display:none\}/,'手机横屏顶部已被状态条与按钮占满，计数器必须让位');
 assert.doesNotMatch(css,/native-bb-cap/,'紧凑版不再保留顶栏那两条英文说明');
});
