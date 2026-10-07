import {EGG_MODE_ID} from './native-325.js';
import {RANDOM_MAP_ID} from './protocol.js';
const CAT_MODE_ID='mode_cat_all';

export const NATIVE_CHANGELOG={
 version:'0.10',publishedAt:'2026-10-07T20:19:56+08:00',displayTime:'2026-10-07 20:19 (UTC+8)',dateLabel:'10.07',
 preview:[
  {topic:'每周挑战',summary:'新增每周挑战入口，在线校时并将挑战规则固定到本局。'},
  {topic:'Android 客户端',summary:'新增 Android WebView 客户端，支持多来源选择、资源缓存与预缓存、存档导入导出。'},
  {topic:'最终 Boss 与战斗',summary:'最终回合保留原战场与部署，修正 Boss 范围和红门增援出生，并清理休整期残留单位。'},
  {topic:'对局与操作修复',summary:'修正白面鸮复制卫戍条件、信标转交时装备处理，以及整备区装备拖放误操作。'},
  {topic:'红门出怪查看',summary:'两处红门分别查看下一轮敌人；手机气泡置顶，敌人种类较多时改用紧凑头像数量网格。'}
 ],
 sections:[
  {title:'每周挑战',items:[
   '大厅新增每周挑战入口；点击时通过 HTTPS 响应时间校准挑战时段，校时失败或当前没有生效挑战时不开放开局。',
   '挑战规则以本局快照保存；挑战结束或配置更新不会改变已经开始的对局。'
  ]},
  {title:'Android 客户端与缓存',items:[
   '新增独立 Android WebView 客户端工程，可选择内置网页来源或配置自定义 HTTPS 来源；网页按客户端标记识别 Android 环境并应用适配样式。',
   '客户端将访问过的网页资源按来源持久缓存；网页提供资源清单时可预缓存全部资源，并校验文件大小与 SHA-256。',
   '客户端支持通过系统文件选择器导入、导出原有 JSON 存档；网页构建同时生成 Android 资源清单。'
  ]},
  {title:'最终 Boss 与回合清理',items:[
   '最终回合沿用玩家选择的原始战场并保留已部署干员；昆图斯与萨米的意志以原图 K2 为中心锚，J1–K3（2 列 × 3 行）用于受击判定、备战预览与部署限制。',
   '修正最终 Boss 增援路线，使增援从原图红门出生；旧版使用独立 Boss 场地的战斗存档会回到原图战前准备并清除旧场地部署。',
   '进入回合休整时清除上一场遗留的敌人、召唤物、投射物与战斗特效，同时保留战斗结果和干员站位。'
  ]},
  {title:'干员、装备与红门查看',items:[
   '白面鸮复制卫戍效果时不再重复检查被复制效果原本的触发条件。',
   '「信标」转交干员时，装备会留在原玩家整备区，不再随未成功交付的转交记录遗失。',
   '修正整备区把装备拖到干员卡时误走手牌换位的问题；拖放现在会命中对应干员并执行装备操作。',
   '两处红门各自显示下一轮从该出怪口出现的敌人头像和数量；敌人队列在备战开始前确定。手机版气泡改为顶层浮层，敌人种类达到 6 种时隐藏名称并缩小头像，以网格显示数量。'
  ]}
 ]
};

const escDefault=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const changelogHtml=(value,escape=escDefault)=>escape(value).replace(/325/g,'<span class="native-flow-color">325</span>');

export function renderLobby({data,state,avatar,esc=escDefault}){
 const operatorCount=Object.keys(data.profiles).length;
 const enemyCount=Object.keys(data.enemies).length;
 const mapCount=data.maps.filter(m=>m.weight>0).length;
 const modes=Object.values(data.season.modeDataDict).filter(m=>m.modeType!=='MULTI'&&m.modeDifficulty!=='TRAINING');
 modes.push({modeId:EGG_MODE_ID,name:'325模式'});
 modes.push({modeId:CAT_MODE_ID,name:'海猫模式'});
 const maps=data.maps.filter(m=>m.weight>0);
 // 阵地下拉第一项是哨兵「随机地图」（用户 2026-09-22 口径，且为默认）：开局时按本局种子抽一个具体阵地。
 const randomMapOption=`<option value="${RANDOM_MAP_ID}" ${state.map===RANDOM_MAP_ID?'selected':''}>随机地图</option>`;
 return `<main class="native-lobby"><header class="native-lobby-topbar"><div class="native-brand"><span class="native-brand-mark" aria-hidden="true">◇</span><div><span class="native-eyebrow">RHODES ISLAND / PRTS</span><strong>联合防卫终端</strong></div></div><div class="native-lobby-meta"><span class="native-live-dot">ONLINE</span></div></header><section class="native-hero"><div class="native-hero-copy"><p class="native-kicker">卫戍协议 · 盟约下半期</p><h1>卫戍协议</h1><p class="native-hero-lead">以真实数据驱动的独立战斗模拟。调配干员、构筑盟约，在连续回合中守住阵地。</p><div class="native-hero-actions"><button class="native-primary native-hero-start" data-act="new"><span>开始一局</span><small>随机生成特训、最终 Boss 与增援 →</small></button><button class="native-weekly-entry" data-act="weekly-challenge"><span>每周挑战</span><small>联网校时并加载本周规则 →</small></button></div><div class="native-hero-facts" aria-label="终端数据"><span><b>${operatorCount}</b><small>干员数据</small></span><span><b>${enemyCount}</b><small>敌人档案</small></span><span><b>${mapCount}</b><small>可用阵地</small></span></div></div><aside class="native-home-card native-hero-panel" aria-labelledby="native-update-title"><div class="native-card-heading native-update-heading"><div><span class="native-eyebrow native-panel-kicker">UPDATE LOG / TERMINAL</span><h2 id="native-update-title">更新日志</h2></div><span class="native-card-index">${esc(NATIVE_CHANGELOG.version)}</span></div><div class="native-operation-line"><span>版本 / 更新时间</span><time class="native-operation-code" datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.displayTime)}</time></div><ul class="native-update-list">${NATIVE_CHANGELOG.preview.map(item=>`<li><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.dateLabel)}</time><div><b>${changelogHtml(item.topic,esc)}</b><p>${changelogHtml(item.summary,esc)}</p></div></li>`).join('')}</ul><div class="native-signal"><span aria-hidden="true"></span><small>点击卡片查看完整更新日志</small><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.version)}</time></div><button class="native-update-hitbox" data-act="update-log" aria-label="查看完整更新日志 ${esc(NATIVE_CHANGELOG.version)}" aria-haspopup="dialog"></button></aside></section><div class="native-home"><section class="native-home-card native-loadout"><div class="native-card-heading"><div><span class="native-eyebrow">MISSION SETUP</span><h2>任务配置</h2></div><span class="native-card-index">01</span></div><label class="native-field-label" for="native-mode">行动难度<select id="native-mode">${modes.map(m=>`<option value="${m.modeId}" ${m.modeId===state.mode?'selected':''}>${m.name}</option>`).join('')}</select></label><label class="native-field-label" for="native-map">作战阵地<select id="native-map">${randomMapOption}${maps.map((m,i)=>`<option value="${m.stageId}" ${m.stageId===state.map?'selected':''}>阵地 ${i+1} · ${m.stageId}</option>`).join('')}</select></label><div class="native-loadout-actions"><button class="native-prep-entry" data-act="prepare"><span class="native-prep-entry-icon" aria-hidden="true">◈</span><span class="native-prep-entry-label">战前准备</span></button>${state.game?'<button data-act="resume">恢复本地模拟</button>':''}<button data-act="import">导入存档</button></div></section><section class="native-home-card native-database"><div class="native-card-heading"><div><span class="native-eyebrow">REFERENCE / TOOLS</span><h2>资料与工具</h2></div><span class="native-card-index">02</span></div><div class="native-tool-grid"><button data-act="editor"><span class="native-tool-icon">▦</span><span><b>协议自定义</b><small>编辑敌人波次、盟约禁用名单与随机禁用方案</small></span><em>→</em></button><button data-act="archive"><span class="native-tool-icon">▤</span><span><b>战绩与解锁</b><small>查看最近对局与已解锁内容</small></span><em>→</em></button><button data-act="passcode"><span class="native-tool-icon">※</span><span><b class="native-flow-color">输入密码</b><small>用数字键盘输入密码</small></span><em>→</em></button></div></section></div><footer class="native-lobby-footer"><span>本期预设与属性来源：PRTS / 历史游戏数据</span><span>非官方同人作品 · v0.10 combat console</span></footer></main>`;
}
