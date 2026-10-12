import {EGG_MODE_ID} from './native-325.js';
import {RANDOM_MAP_ID,mapThumbnailHtml} from './protocol.js';
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
 const modes=Object.values(data.season.modeDataDict).filter(m=>m.modeType!=='MULTI'&&m.modeDifficulty!=='TRAINING');
 modes.push({modeId:EGG_MODE_ID,name:'325模式'});
 modes.push({modeId:CAT_MODE_ID,name:'海猫模式'});
 const maps=data.maps.filter(m=>m.weight>0);
 // 阵地下拉第一项是哨兵「随机地图」（用户 2026-09-22 口径，且为默认）：开局时按本局种子抽一个具体阵地。
 const randomMapOption=`<option value="${RANDOM_MAP_ID}" ${state.map===RANDOM_MAP_ID?'selected':''}>随机地图</option>`;
 const selected=maps.find(map=>map.stageId===state.map),previews=selected?[selected]:maps.slice(0,3);
 return `<main class="native-lobby native-home-screen">
 <header class="native-lobby-topbar"><div class="native-brand"><strong>卫戍协议</strong><span>盟约 · 下半期</span></div><button class="native-version-entry" data-act="update-log">更新日志 <span>v${esc(NATIVE_CHANGELOG.version)}</span></button></header>
 <section class="native-hero">
  <div class="native-hero-copy"><h1>盟约 · 下半期</h1><p class="native-hero-lead">调配干员，合成精锐，迎击最后一轮领袖。</p>
   <section class="native-loadout"><h2>开局设置</h2><div class="native-setup-fields"><label class="native-field-label" for="native-mode">行动难度<select id="native-mode">${modes.map(m=>`<option value="${m.modeId}" ${m.modeId===state.mode?'selected':''}>${m.name}</option>`).join('')}</select></label><label class="native-field-label" for="native-map">作战阵地<select id="native-map">${randomMapOption}${maps.map((m,i)=>`<option value="${m.stageId}" ${m.stageId===state.map?'selected':''}>阵地 ${i+1} · ${m.stageId}</option>`).join('')}</select></label></div><div class="native-loadout-actions"><button class="native-prep-entry" data-act="prepare"><span class="native-prep-entry-icon" aria-hidden="true">◈</span><span class="native-prep-entry-label">战前准备</span></button>${state.game?'<button data-act="resume">恢复本地模拟</button>':''}<button data-act="import">导入存档</button></div></section>
   <div class="native-hero-actions"><button class="native-primary native-hero-start" data-act="new">开始一局</button><button class="native-weekly-entry" data-act="weekly-challenge">每周挑战</button></div>
  </div>
  <aside class="native-battlefield-preview" aria-label="作战阵地预览"><header><h2>${selected?'当前阵地':'随机阵地'}</h2><span>${selected?esc(selected.stageId):'开局后确定'}</span></header><div class="native-home-maps${selected?' is-single':''}">${previews.map(map=>`<figure>${mapThumbnailHtml(map,{esc,label:'阵地预览 '+map.stageId})}<figcaption>阵地 ${maps.indexOf(map)+1}</figcaption></figure>`).join('')}</div><p>${selected?'敌方从红门进入，守住蓝门。':`从 ${maps.length} 张可用阵地中随机选择，上方展示部分战场。`}</p><div class="native-home-map-key"><span><i class="terrain-entry"></i>敌方入口</span><span><i class="terrain-goal"></i>防守目标</span></div></aside>
 </section>
 <div class="native-home"><section class="native-home-card native-home-updates"><header class="native-card-heading"><h2>近期更新</h2><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.dateLabel)}</time></header><ul class="native-update-list">${NATIVE_CHANGELOG.preview.map(item=>`<li><div><b>${changelogHtml(item.topic,esc)}</b><p>${changelogHtml(item.summary,esc)}</p></div></li>`).join('')}</ul><button class="native-update-more" data-act="update-log">查看完整更新日志</button></section>
 <section class="native-home-card native-database"><header class="native-card-heading"><h2>资料与工具</h2></header><div class="native-tool-grid"><button data-act="editor"><span class="native-tool-icon">▦</span><span><b>协议自定义</b><small>调整敌人波次与盟约禁用方案</small></span></button><button data-act="archive"><span class="native-tool-icon">▤</span><span><b>战绩与解锁</b><small>查看最近对局与已解锁内容</small></span></button><button data-act="passcode"><span class="native-tool-icon">※</span><span><b>输入密码</b><small>用数字键盘输入密码</small></span></button></div></section></div>
 <footer class="native-lobby-footer"><span>非官方同人作品</span><span>数据来源：PRTS 与历史游戏数据</span></footer></main>`;
}
