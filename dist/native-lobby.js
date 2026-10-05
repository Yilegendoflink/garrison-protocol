import {EGG_MODE_ID} from './native-325.js';
import {RANDOM_MAP_ID} from './protocol.js';
const CAT_MODE_ID='mode_cat_all';

export const NATIVE_CHANGELOG={
 version:'0.9-d',publishedAt:'2026-10-05T13:02:36+08:00',displayTime:'2026-10-05 13:02 (UTC+8)',dateLabel:'10.05',
 preview:[
  {topic:'突袭与控制',summary:'修复突袭干员反复再部署、错误跳位，以及伊内丝和仇白的重复控制问题。'},
  {topic:'技能与盟约',summary:'修正多名干员技能的目标、持续时间和效果触发；校正阿戈尔复活对象。'},
  {topic:'最终 Boss',summary:'按资料修正 Boss 判定范围与场地，并阻止余 S2 移动最终 Boss。'},
  {topic:'策略与商店',summary:'寻呼模块不再补重复选项；梓兰冻结按钮统一冻结或解冻全店。'},
  {topic:'数据同步',summary:'同步运行时与素材数据。'}
 ],
 sections:[
  {title:'突袭、部署与控制',items:[
   '突袭再部署只选择目标地面敌人相邻的地块；相邻格不可部署时不再跳到远处空地。',
   '修正突袭干员在无有效目标、近地悬浮敌人附近及技能就绪时反复横跳或重复再部署的问题。',
   '补充突袭干员重新部署时触发部署效果的回归验证。',
   '修复伊内丝 S3 反复进入再部署的问题；她对同一敌人不再每次普攻都重复束缚。',
   '仇白的停顿效果不再因重复触发而无限延长。'
  ]},
  {title:'技能与盟约效果',items:[
   '古米 S1 修正为单体治疗，不再错误攻击敌人或按群攻处理。',
   '修正异格德克萨斯 S3 持续时间过长的问题。',
   '异格银灰 S2 按减速效果结算，不再直接冻结敌人。',
   '叙拉古盟约的恐惧效果恢复；荒芜拉普兰德浮游单元可以正常触发真伤。',
   '瞬发技能也能正确触发迅捷盟约效果；缇缇 S2 的沉睡刷新会按实际触发叠加卫戍层数。',
   '锏的卫戍效果说明保留正确的触发时机标记。',
   '阿戈尔盟约的复活只作用于阿戈尔干员，非阿戈尔单位退场不再占用复活名额。',
   '修正卡西米尔阻挡真伤递归触发并造成栈溢出的问题。'
  ]},
  {title:'最终 Boss 与战场',items:[
   '按资料记录扩大并右移最终 Boss 判定范围；浊心斯卡蒂 S3 的伤害判定也能覆盖 Boss。',
   '最终 Boss 战使用对应的专属场地地图。',
   '余 S2 不再吸动最终 Boss。'
  ]},
  {title:'策略、商店与资料',items:[
   '寻呼模块候选少于三名时只显示实际候选，不再用重复干员补足选项。',
   '梓兰策略的冻结槽继续保留；商店同时有冻结卡和未冻结卡时，冻结按钮会冻结全店；全店冻结后按钮解冻所有卡，不提供单卡解冻。',
   '同步运行时与素材数据。'
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
 return `<main class="native-lobby"><header class="native-lobby-topbar"><div class="native-brand"><span class="native-brand-mark" aria-hidden="true">◇</span><div><span class="native-eyebrow">RHODES ISLAND / PRTS</span><strong>联合防卫终端</strong></div></div><div class="native-lobby-meta"><span class="native-live-dot">ONLINE</span></div></header><section class="native-hero"><div class="native-hero-copy"><p class="native-kicker">卫戍协议 · 盟约下半期</p><h1>卫戍协议</h1><p class="native-hero-lead">以真实数据驱动的独立战斗模拟。调配干员、构筑盟约，在连续回合中守住阵地。</p><div class="native-hero-actions"><button class="native-primary native-hero-start" data-act="new"><span>开始一局</span><small>随机生成特训、最终 Boss 与增援 →</small></button></div><div class="native-hero-facts" aria-label="终端数据"><span><b>${operatorCount}</b><small>干员数据</small></span><span><b>${enemyCount}</b><small>敌人档案</small></span><span><b>${mapCount}</b><small>可用阵地</small></span></div></div><aside class="native-home-card native-hero-panel" aria-labelledby="native-update-title"><div class="native-card-heading native-update-heading"><div><span class="native-eyebrow native-panel-kicker">UPDATE LOG / TERMINAL</span><h2 id="native-update-title">更新日志</h2></div><span class="native-card-index">${esc(NATIVE_CHANGELOG.version)}</span></div><div class="native-operation-line"><span>版本 / 更新时间</span><time class="native-operation-code" datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.displayTime)}</time></div><ul class="native-update-list">${NATIVE_CHANGELOG.preview.map(item=>`<li><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.dateLabel)}</time><div><b>${changelogHtml(item.topic,esc)}</b><p>${changelogHtml(item.summary,esc)}</p></div></li>`).join('')}</ul><div class="native-signal"><span aria-hidden="true"></span><small>点击卡片查看完整更新日志</small><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.version)}</time></div><button class="native-update-hitbox" data-act="update-log" aria-label="查看完整更新日志 ${esc(NATIVE_CHANGELOG.version)}" aria-haspopup="dialog"></button></aside></section><div class="native-home"><section class="native-home-card native-loadout"><div class="native-card-heading"><div><span class="native-eyebrow">MISSION SETUP</span><h2>任务配置</h2></div><span class="native-card-index">01</span></div><label class="native-field-label" for="native-mode">行动难度<select id="native-mode">${modes.map(m=>`<option value="${m.modeId}" ${m.modeId===state.mode?'selected':''}>${m.name}</option>`).join('')}</select></label><label class="native-field-label" for="native-map">作战阵地<select id="native-map">${randomMapOption}${maps.map((m,i)=>`<option value="${m.stageId}" ${m.stageId===state.map?'selected':''}>阵地 ${i+1} · ${m.stageId}</option>`).join('')}</select></label><div class="native-loadout-actions"><button class="native-prep-entry" data-act="prepare"><span class="native-prep-entry-icon" aria-hidden="true">◈</span><span class="native-prep-entry-label">战前准备</span></button>${state.game?'<button data-act="resume">恢复本地模拟</button>':''}<button data-act="import">导入存档</button></div></section><section class="native-home-card native-database"><div class="native-card-heading"><div><span class="native-eyebrow">REFERENCE / TOOLS</span><h2>资料与工具</h2></div><span class="native-card-index">02</span></div><div class="native-tool-grid"><button data-act="editor"><span class="native-tool-icon">▦</span><span><b>协议自定义</b><small>编辑敌人波次、盟约禁用名单与随机禁用方案</small></span><em>→</em></button><button data-act="archive"><span class="native-tool-icon">▤</span><span><b>战绩与解锁</b><small>查看最近对局与已解锁内容</small></span><em>→</em></button><button data-act="passcode"><span class="native-tool-icon">※</span><span><b class="native-flow-color">输入密码</b><small>用数字键盘输入密码</small></span><em>→</em></button></div></section></div><footer class="native-lobby-footer"><span>本期预设与属性来源：PRTS / 历史游戏数据</span><span>非官方同人作品 · v0.9 combat console</span></footer></main>`;
}
