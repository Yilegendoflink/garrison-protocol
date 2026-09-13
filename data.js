export const VERSION = 1;
export const ROMAN = ['','I','II','III','IV','V','VI'];
export const CLASSES = {
 vanguard:{name:'先锋',glyph:'⚑',color:'#e3b575'}, guard:{name:'近卫',glyph:'⚔',color:'#ed9875'}, defender:{name:'重装',glyph:'⬡',color:'#8bb7cc'}, sniper:{name:'狙击',glyph:'⌖',color:'#c3d59a'}, caster:{name:'术师',glyph:'◇',color:'#b2a0d7'}, medic:{name:'医疗',glyph:'✚',color:'#8bc5b1'}, supporter:{name:'辅助',glyph:'✧',color:'#78c7d5'}, specialist:{name:'特种',glyph:'⟐',color:'#c9a6be'}
};
export const ALLIANCES = {
 rhodes:{name:'协防干员',symbol:'⌘',need:3,desc:'3 名不同干员激活。每层提升全体生命 0.5%、攻击 0.25%。',kind:'生命 / 攻击'},
 victoria:{name:'维多利亚',symbol:'♜',need:3,desc:'3 名不同干员激活。每层提高盟约干员物理伤害 0.8%，每 15 层提供 1 点下回合资金。',kind:'物理 / 资金'},
 siracusa:{name:'叙拉古',symbol:'♠',need:2,desc:'2 名不同干员激活。每层增加盟约干员暴击率 0.6%，暴击造成 175% 伤害。',kind:'暴击 / 追击'},
 laterano:{name:'拉特兰',symbol:'✥',need:2,desc:'2 名不同干员激活。每层提高远程干员攻击速度 0.8%。',kind:'攻击速度'},
 kjerag:{name:'谢拉格',symbol:'❄',need:2,desc:'2 名不同干员激活。谢拉格攻击附带寒冷；每层增加对寒冷敌人的伤害 1%。',kind:'寒冷 / 增伤'},
 yan:{name:'炎',symbol:'炎',need:2,desc:'2 名不同干员激活。每层提高全体防御 0.7%，每 20 层提高 5 点法术抗性。',kind:'防御 / 法抗'},
 aegir:{name:'阿戈尔',symbol:'≋',need:2,desc:'2 名不同干员激活。每层提升盟约干员生命 1%，每秒恢复最大生命的 0.3%。',kind:'生命 / 再生'},
 columbia:{name:'哥伦比亚',symbol:'⌬',need:2,desc:'2 名不同干员激活。每层提高治疗量 0.7%；装备的属性增益额外提高 25%。',kind:'治疗 / 装备'},
 firm:{name:'坚守',symbol:'⬡',need:3,desc:'3 名不同干员激活。全体防御提高 10% + 每层 0.6%；30 层后重装额外阻挡 1 个敌人。',kind:'防御 / 阻挡'},
 swift:{name:'迅捷',symbol:'»',need:3,desc:'3 名不同干员激活。全体攻击速度提高 10% + 每层 0.6%。',kind:'攻击速度'},
 precise:{name:'精准',symbol:'⌖',need:2,desc:'2 名不同干员激活。狙击攻击无视 30 + 每层 3 点防御。',kind:'破甲 / 对空'},
 arcane:{name:'奥术',symbol:'◇',need:3,desc:'3 名不同干员激活。每层增加 0.8% 法术伤害，并忽略目标 0.2 点法术抗性。',kind:'法术 / 穿透'},
 insight:{name:'远见',symbol:'◉',need:2,desc:'2 名不同干员激活。每 20 层获得 1 次回合免费刷新，100 层后干员招募费用减少 1。',kind:'刷新 / 招募'},
 miracle:{name:'奇迹',symbol:'✧',need:2,desc:'2 名不同干员激活。每层提高技力回复速度 0.8%。',kind:'技力回复'},
 assault:{name:'突袭',symbol:'↯',need:2,desc:'2 名不同干员激活。每层缩短再部署时间 0.8%，上限 60%；基础攻击提高 8%。',kind:'再部署 / 攻击'}
};
const sk=(name,type,sp,duration,power,desc,extra={})=>({name,type,sp,duration,power,desc,recovery:'auto',activation:'auto',initialSP:0,...extra});
const op=(id,name,tier,cls,hp,atk,def,range,block,alliances,skill,extra={})=>({id,name,tier,cls,hp,atk,def,res:0,range,block,alliances,skills:[skill],interval:cls==='medic'?2.4:cls==='caster'?1.6:cls==='defender'?1.25:1.05,redeploy:32,dp:cls==='defender'?18:cls==='medic'?16:cls==='caster'?18:12,damage:cls==='caster'||cls==='supporter'?'arts':'physical',placement:['sniper','caster','medic','supporter'].includes(cls)?'ranged':'melee',trait:'end',traitValue:2,...extra});
export const OPERATORS = [
 op('fang','芬',1,'vanguard',1150,285,240,1,2,['rhodes','firm'],sk('冲锋号令','dp',18,0,8,'自动获得 8 部署费用。'),{trait:'start',traitValue:2}),
 op('vanilla','香草',1,'vanguard',1080,320,205,1,2,['rhodes','swift'],sk('冲锋号令·援护','buff',20,10,1.5,'攻击力提高 50%，获得 6 部署费用。',{dp:6})),
 op('kroos','克洛丝',1,'sniper',780,305,110,3,1,['rhodes','precise'],sk('二连射','burst',9,0,1.6,'对当前目标连续攻击 2 次，每次造成 160% 攻击力的伤害。',{hits:2,recovery:'attack',activation:'nextAttack'}),{interval:.95,trait:'kill',traitValue:1}),
 op('melantha','玫兰莎',1,'guard',1650,425,145,1,1,['victoria','assault'],sk('攻击力强化','buff',20,14,1.8,'攻击力提高 80%。'),{trait:'acquire',traitValue:4}),
 op('beagle','米格鲁',1,'defender',1680,240,390,1,3,['rhodes','firm'],sk('防御力强化','defense',20,15,1.8,'防御力提高 80%，每秒恢复 1% 生命。')),
 op('ansel','安赛尔',1,'medic',850,335,105,3,1,['rhodes','miracle'],sk('治疗范围强化','heal',18,14,1.45,'治疗量提高 45%，治疗范围扩大 1 格。'),{trait:'skill',traitValue:2}),
 op('plume','翎羽',2,'vanguard',1150,410,230,1,1,['laterano','swift'],sk('迅捷打击','buff',18,15,1.5,'攻击力提高 50%，攻击速度提高 35%。',{speed:1.35}),{trait:'kill',traitValue:1,killDP:1}),
 op('jessica','杰西卡',2,'sniper',1050,370,150,3,1,['columbia','precise'],sk('烟幕','buff',22,16,1.65,'攻击力提高 65%，获得 50% 物理与法术闪避。',{dodge:.5}),{trait:'end',traitValue:3}),
 op('gitano','远山',2,'caster',1100,470,140,3,1,['rhodes','arcane'],sk('命运','buff',28,15,1.7,'攻击力提高 70%，同时攻击范围内所有敌人。',{all:true}),{aoe:1.2,interval:2.3,trait:'refresh',traitValue:2}),
 op('gummy','古米',2,'defender',2050,310,430,1,3,['rhodes','firm','miracle'],sk('备用军粮','selfheal',12,0,1.7,'治疗附近生命比例最低的友方，回复相当于攻击力 170% 的生命。'),{trait:'skill',traitValue:2}),
 op('courier','讯使',2,'vanguard',1550,350,340,1,2,['kjerag','firm'],sk('冲锋号令·防御','defense',22,13,1.5,'防御力提高 50%，获得 10 部署费用。',{dp:10}),{trait:'start',traitValue:3}),
 op('perfumer','调香师',2,'medic',1120,305,130,3,1,['rhodes','miracle'],sk('精调','heal',26,15,2,'治疗量翻倍，同时治疗 3 人。'),{multi:3,regen:.003,trait:'end',traitValue:3}),
 op('vigna','红豆',3,'vanguard',1450,480,290,1,1,['rhodes','assault'],sk('槌音','buff',24,16,2,'攻击力提高 100%。'),{killDP:1,trait:'kill',traitValue:2}),
 op('shirayuki','白雪',3,'sniper',1250,460,185,4,1,['yan','precise'],sk('凝武','buff',25,17,1.45,'攻击变为法术伤害，附带范围减速。',{arts:true,slow:.45}),{aoe:1.1,interval:2.1,trait:'end',traitValue:4}),
 op('amiya','阿米娅',3,'caster',1260,515,170,3,1,['rhodes','arcane'],sk('战术咏唱','buff',22,18,1,'攻击速度提高 75%。',{speed:1.75}),{res:15,trait:'skill',traitValue:3,skills:[sk('战术咏唱','buff',22,18,1,'攻击速度提高 75%。',{speed:1.75}),sk('奇美拉','buff',45,20,2.2,'攻击力提高 120%，攻击变为真实伤害，范围扩大。',{trueDamage:true,range:1})]}),
 op('texas','德克萨斯',3,'vanguard',1570,410,320,1,2,['siracusa','swift'],sk('剑雨','stun',24,0,1.7,'获得 12 部署费用，对周围敌人造成两次法术伤害并晕眩 3 秒。',{dp:12,hits:2}),{trait:'acquire',traitValue:6}),
 op('cliffheart','崖心',3,'specialist',1480,500,270,3,2,['kjerag','assault'],sk('束缚链','pull',18,0,1.8,'拉拽前方最多 3 个敌人，造成真实伤害并晕眩 2 秒。'),{placement:'either',trait:'skill',traitValue:3}),
 op('pramanix','初雪',3,'supporter',1190,420,155,3,1,['kjerag','insight','arcane'],sk('自然震慑','debuff',24,16,.45,'范围内敌人防御力降低 45%，法术抗性降低 15。'),{res:20,slow:.8,trait:'refresh',traitValue:4}),
 op('lappland','拉普兰德',4,'guard',1900,560,360,2,2,['siracusa','arcane'],sk('狼魂','buff',24,18,1.9,'攻击变为法术伤害，攻击力提高 90%，同时攻击 2 个目标。',{arts:true,multi:2}),{trait:'refresh',traitValue:6,antiAir:true}),
 op('silence','赫默',4,'medic',1460,495,180,3,1,['columbia','miracle'],sk('医疗无人机','drone',25,12,1.2,'自动在伤势最重的友方身边启动医疗无人机，持续治疗附近友方。'),{trait:'start',traitValue:5}),
 op('meteorite','陨星',4,'sniper',1500,610,190,4,1,['rhodes','precise'],sk('高爆弹头','burst',15,0,2.2,'发射爆炸弹，对目标与周围敌人造成 220% 物理伤害，削减防御 120。',{aoe:1.7}),{aoe:1.4,interval:2.2,trait:'kill',traitValue:2}),
 op('ptilopsis','白面鸮',4,'medic',1480,390,175,3,1,['columbia','insight','miracle'],sk('脑啡肽','heal',32,19,1.65,'治疗量提高 65%，攻击速度提高 70%，范围扩大。',{speed:1.7}),{multi:3,trait:'end',traitValue:5}),
 op('specter','幽灵鲨',4,'guard',2220,570,340,1,3,['aegir','assault'],sk('肉斩骨断','buff',30,16,2,'攻击力提高 100%，技能期间生命不会低于 1。',{immortal:true}),{multi:3,regen:.005,trait:'death',traitValue:8}),
 op('saria','塞雷娅',5,'defender',2800,480,580,1,3,['columbia','firm','miracle'],sk('药物配置','groupheal',17,0,1.9,'治疗自身周围所有友方，每名回复攻击力 190% 的生命。'),{res:10,trait:'skill',traitValue:5}),
 op('exusiai','能天使',5,'sniper',1650,480,190,3,1,['laterano','precise','swift'],sk('过载模式','buff',29,15,1.15,'每次攻击连续射击 5 次，每发造成 115% 攻击力的物理伤害。',{hits:5,attackScale:1.15}),{interval:.8,trait:'kill',traitValue:3}),
 op('silverash','银灰',5,'guard',2450,730,410,2,2,['kjerag','assault','insight'],sk('真银斩','buff',39,20,2.3,'攻击力提高 130%，范围扩大，同时攻击最多 6 个目标，防御降低 40%。',{multi:6,range:2,def:.6}),{antiAir:true,trait:'skill',traitValue:8}),
 op('hoshiguma','星熊',5,'defender',3200,525,690,1,3,['yan','firm'],sk('力之锯','buff',32,20,1.8,'攻击力提高 80%，防御提高 70%，攻击身前所有敌人。',{def:1.7,all:true}),{dodge:.15,trait:'death',traitValue:8}),
 op('shining','闪灵',5,'medic',1750,590,190,3,1,['rhodes','firm','miracle'],sk('教条力场','heal',37,22,1.5,'治疗量提高 50%，治疗时为目标提供防御力提高 80% 的护盾。',{armor:1.8}),{trait:'skill',traitValue:6}),
 op('eyjafjalla','艾雅法拉',6,'caster',1900,750,205,3,1,['rhodes','arcane','insight'],sk('火山','buff',42,18,1.7,'攻击力提高 70%，攻击间隔大幅缩短，范围扩大，同时攻击 6 个目标。',{multi:6,speed:2.1,range:1}),{res:25,trait:'skill',traitValue:8}),
 op('thorns','棘刺',6,'guard',2800,700,460,2,2,['aegir','swift'],sk('至高之术','buff',26,24,1.9,'攻击力提高 90%，攻击速度提高 40%，范围扩大；第二次开启后持续至战斗结束。',{range:1,speed:1.4,permanentSecond:true}),{antiAir:true,regen:.006,trait:'kill',traitValue:3}),
 op('blaze','煌',6,'guard',3300,760,470,1,3,['rhodes','assault'],sk('链锯延伸模块','buff',36,999,1.9,'攻击力提高 90%，防御提高 25%，攻击范围延伸，持续至战斗结束。',{range:1,def:1.25}),{multi:3,trait:'kill',traitValue:3}),
 op('suzuran','铃兰',6,'supporter',1800,610,190,3,1,['siracusa','insight','arcane'],sk('狐火渺然','sanctuary',40,22,1.45,'停止攻击，扩大范围；范围内敌人显著减速并受到额外 45% 伤害，同时持续治疗友方。'),{slow:.6,res:25,trait:'end',traitValue:7}),
 op('nightingale','夜莺',6,'medic',1850,540,175,3,1,['rhodes','miracle'],sk('圣域','heal',38,24,1.8,'治疗量提高 80%，范围扩大；治疗时赋予 40 点额外法术抗性。',{range:1,res:40}),{multi:3,res:20,trait:'skill',traitValue:6}),
 op('mountain','山',6,'guard',2900,690,430,1,2,['columbia','swift'],sk('横扫架势','buff',9,999,1.5,'攻击力提高 50%，同时攻击 2 个目标，每秒恢复最大生命的 5%。',{multi:2,regen:.05}),{interval:.75,trait:'end',traitValue:6}),
 op('chen','陈',6,'guard',2700,650,450,1,2,['yan','assault'],sk('赤霄·绝影','burst',30,0,2,'对范围内目标连续斩击 10 次，每次造成 200% 物理伤害，晕眩 3 秒。',{hits:10}),{trait:'skill',traitValue:8})
];
// Adaptation profiles, not extracted original animation/range data.
for(const o of OPERATORS){
 o.rangeCells=[];
 for(let x=-1;x<=o.range;x++)for(let y=-1;y<=1;y++){
  const included=o.placement==='melee'&&o.range===1?y===0&&x>=0:!(x===o.range&&y!==0&&o.range>=3);
  if(included)o.rangeCells.push([x,y]);
 }
 o.attackWindup=o.interval*.3;
 o.projectileSpeed=o.placement==='ranged'?6:0;
 o.targetPriority=['kroos','jessica','exusiai'].includes(o.id)?'air':'exit';
}
export const OP = Object.fromEntries(OPERATORS.map(o=>[o.id,o]));
export const EQUIPMENT = [
 {id:'blade',name:'战术瞄准镜',tier:1,cost:2,glyph:'⌖',desc:'攻击力 +20% / 进阶 +40%。',atk:.2},
 {id:'armor',name:'复合防护板',tier:1,cost:2,glyph:'⬡',desc:'防御力 +30%，生命 +15%；进阶效果翻倍。',def:.3,hp:.15},
 {id:'battery',name:'源石电池',tier:2,cost:2,glyph:'ϟ',desc:'技力回复 +35%，初始技力 +8；进阶效果翻倍。',sp:.35,initialSP:8},
 {id:'scope',name:'高速装填器',tier:2,cost:3,glyph:'»',desc:'攻击速度 +25% / 进阶 +50%。',speed:.25},
 {id:'medkit',name:'应急再生组件',tier:3,cost:3,glyph:'✚',desc:'生命 +20%，每秒回复 1% 生命；进阶效果翻倍。',hp:.2,regen:.01},
 {id:'arts',name:'法术增幅器',tier:3,cost:3,glyph:'◇',desc:'攻击力 +25%，法术抗性 +15；进阶效果翻倍。',atk:.25,res:15},
 {id:'return',name:'快速重整模块',tier:4,cost:3,glyph:'↻',desc:'再部署时间与再部署费用降低 35%；进阶降低 70%。',redeploy:.35},
 {id:'crown',name:'精锐作战套件',tier:5,cost:4,glyph:'♜',desc:'攻击、防御、生命各 +30%；进阶各 +60%。',atk:.3,def:.3,hp:.3},
];
export const EQ=Object.fromEntries(EQUIPMENT.map(e=>[e.id,e]));
export const SPELLS=[{id:'repair',name:'应急修复',glyph:'✚',desc:'休整期使用：恢复 5 点目标生命。',effect:'hp',value:5},{id:'elite',name:'晋升调配装置',glyph:'♜',desc:'休整期选择一名初始干员，直接晋升精锐并获得晋升招募。',effect:'elite'},{id:'cash',name:'紧急物资',glyph:'◆',desc:'休整期使用：立即获得 5 资金。',effect:'money',value:5}];
export const SP=Object.fromEntries(SPELLS.map(e=>[e.id,e]));
export const STRATEGIES=[
 {id:'perfect',name:'天衣无缝',author:'阿米娅',glyph:'01',hp:30,money:0,desc:'全体干员攻击、防御与生命提高 20%。稳固防线，循序推进。',tag:'稳定开局 · 推荐首次模拟'},
 {id:'logistics',name:'后勤保障',author:'可露希尔',glyph:'02',hp:26,money:2,desc:'每回合额外获得 2 资金。通过招募与快速升级建立优势。',tag:'资源运营 · 更快成型'},
 {id:'adaptive',name:'以己之长',author:'陈',glyph:'03',hp:22,money:0,desc:'远程干员自动选择物理或法术中的较高伤害，精准应对不同敌人。',tag:'针对打击 · 高台核心'}
];
export const DECISIONS=[
 {id:'flawless',name:'无瑕',glyph:'◇',desc:'全体干员攻击、防御、生命提高 10%，攻击速度提高 10%。'},
 {id:'funding',name:'稳定补给',glyph:'◆',desc:'之后每个休整期额外获得 2 资金。'},
 {id:'expand',name:'协同战线',glyph:'⌘',desc:'部署位上限增加 2，并立即获得一件随机装备。'},
 {id:'medical',name:'后方医疗',glyph:'✚',desc:'目标生命恢复 8；每回合开始再恢复 1。'},
 {id:'training',name:'定向晋升',glyph:'♜',desc:'获得一个晋升调配装置，使任意一名初始干员直接成为精锐。'},
 {id:'research',name:'快速响应',glyph:'ϟ',desc:'全体干员技力回复提高 25%，再部署时间缩短 20%。'},
 {id:'union',name:'深化盟约',glyph:'✧',desc:'所有已激活盟约增加 15 层，之后休整期结束再增加 3 层。'},
 {id:'reinforce',name:'精英增援',glyph:'⚑',desc:'获得 2 名当前调度等级高一阶的随机干员。'},
 {id:'bounty',name:'接受悬赏',glyph:'⌖',desc:'后续回合多出现 2 名精英敌人；清剿全部悬赏目标后，下回合获得额外 3 资金。'},
 {id:'wall',name:'城墙',glyph:'⬡',desc:'每轮第一个阻挡敌人的干员获得等于其最大生命 150% 的屏障。'}
];
const path=(points)=>{let a=[];for(let i=0;i<points.length-1;i++){const [x,y]=points[i], [xx,yy]=points[i+1], n=Math.max(Math.abs(xx-x),Math.abs(yy-y));for(let j=0;j<n;j++) a.push([x+Math.sign(xx-x)*j,y+Math.sign(yy-y)*j]);}a.push(points.at(-1));return a;};
export const MAPS=[
 {id:'frontier',name:'边境中继站',code:'R-07',cols:11,rows:7,paths:[path([[10,1],[3,1],[3,3],[0,3]]),path([[10,5],[3,5],[3,3],[0,3]])],high:[[2,0],[4,0],[5,0],[7,0],[8,0],[2,2],[4,2],[5,2],[7,2],[8,2],[2,4],[4,4],[5,4],[7,4],[8,4],[2,6],[4,6],[5,6],[7,6],[8,6]],blocked:[[0,0],[1,0],[0,1],[1,1],[0,5],[1,5],[0,6],[1,6],[10,0],[10,6]],desc:'双路汇流。提前在转角阻挡敌人，高台提供交叉火力。'},
 {id:'foundry',name:'废弃铸造厂',code:'F-12',cols:11,rows:7,paths:[path([[10,3],[7,3],[7,1],[3,1],[3,3],[0,3]]),path([[10,3],[7,3],[7,5],[3,5],[3,3],[0,3]])],high:[[2,0],[4,0],[5,0],[6,0],[8,0],[2,2],[4,2],[5,2],[6,2],[8,2],[2,4],[4,4],[5,4],[6,4],[8,4],[2,6],[4,6],[5,6],[6,6],[8,6]],blocked:[[0,0],[1,0],[0,6],[1,6],[10,0],[10,1],[10,5],[10,6]],desc:'中路分流。利用远程射界同时覆盖南北通道。'},
 {id:'outpost',name:'荒原哨所',code:'O-03',cols:11,rows:7,paths:[path([[10,1],[6,1],[6,3],[3,3],[3,5],[0,5]]),path([[10,5],[8,5],[8,3],[3,3],[3,5],[0,5]])],high:[[3,0],[5,0],[7,0],[8,0],[4,2],[5,2],[7,2],[9,2],[2,4],[4,4],[5,4],[7,4],[9,4],[2,6],[4,6],[6,6],[7,6],[9,6]],blocked:[[0,0],[0,1],[0,2],[1,0],[1,1],[0,6],[1,6],[10,0],[10,6]],desc:'狭窄曲折的长通道。坚守中路，防止高速单位突围。'}
];
export const ENEMIES={
 soldier:{name:'源石虫群',glyph:'◈',hp:480,atk:110,def:30,res:0,speed:.62,interval:1.4,leak:1,icon:'soldier'},
 dog:{name:'猎犬',glyph:'»',hp:650,atk:200,def:15,res:0,speed:1.05,interval:1,leak:1,icon:'hound'},
 guard:{name:'整合运动士兵',glyph:'♟',hp:1300,atk:340,def:130,res:0,speed:.58,interval:1.3,leak:1,icon:'soldier'},
 drone:{name:'武装无人机',glyph:'⌁',hp:920,atk:180,def:70,res:10,speed:.56,interval:2.1,leak:1,flying:true,ranged:2.5,icon:'drone'},
 armor:{name:'重装防御者',glyph:'⬟',hp:2850,atk:450,def:690,res:0,speed:.38,interval:1.8,leak:2,icon:'heavy'},
 caster:{name:'术师组长',glyph:'♜',hp:1550,atk:330,def:140,res:50,speed:.47,interval:2.1,leak:1,ranged:2.6,arts:true,icon:'caster'},
 runner:{name:'幽灵组长',glyph:'⟐',hp:1150,atk:0,def:150,res:30,speed:1.2,interval:1,leak:1,unblockable:true,icon:'soldier'},
 breaker:{name:'破阵者',glyph:'⚔',hp:3700,atk:740,def:300,res:20,speed:.46,interval:1.8,leak:2,icon:'heavy'},
 golem:{name:'泥岩巨像',glyph:'▣',hp:7900,atk:1100,def:800,res:30,speed:.29,interval:2.8,leak:3,icon:'heavy'},
 mudrock:{name:'泥岩',glyph:'♜',hp:57000,atk:1300,def:730,res:35,speed:.24,interval:2.3,leak:30,boss:true,shield:6500,icon:'mudrock'},
 core:{name:'隐秘核心',glyph:'◈',hp:79000,atk:1100,def:450,res:45,speed:.23,interval:2,leak:35,boss:true,ranged:3,arts:true,shield:10000,icon:'mudrock'}
};
export const WAVES=[
 ['外围接触','soldier',3,'少量敌人沿北侧接近，部署近战干员阻挡即可。'],
 ['机动侦察','dog',5,'高速猎犬来袭。单体阻挡容易被连续敌人突破。'],
 ['正面突进','guard',6,'双路推进。尽早为第二条路线配置阻挡干员。'],
 ['低空侵袭','drone',7,'空中单位无法阻挡，需要狙击或术师覆盖航线。'],
 ['钢铁阵列','armor',6,'敌人具有较高物理防御，法术攻击更为有效。'],
 ['术式干扰','caster',8,'远程法术攻击威胁前线，医疗干员维持续航。'],
 ['无声奔袭','runner',9,'无法被阻挡的敌人。使用减速与远程火力拦截。'],
 ['防线突破','breaker',8,'高攻击敌人，注意重装干员的生命与治疗覆盖。'],
 ['空中封锁','drone',12,'成群的武装无人机，全线检查对空能力。'],
 ['重装推进','armor',10,'重装与精英部队入场，为核心输出配置装备。'],
 ['源石风暴','caster',11,'高法抗的术师阵列，物理输出可以有效压制。'],
 ['幽灵行军','runner',14,'高速单位集中进攻，范围控制与攻速至关重要。'],
 ['巨像行列','golem',5,'极高生命与防御的巨像，切勿只依赖单一伤害。'],
 ['最后防线','breaker',14,'多批精英进攻，技能循环与自动再部署将接受考验。'],
 ['围城','armor',15,'领袖前的最后攻势，保留生命并完成核心阵容。'],
 ['领袖决战','mudrock',1,'泥岩拥有周期护盾、范围锤击，并召唤泥岩巨像。'],
 ['隐秘核心','core',1,'特别挑战：核心拥有高额护盾，并周期释放全场脉冲。']
];
export const DIFFICULTIES={standard:{name:'标准模拟',scale:.8,desc:'适合熟悉规则'},danger:{name:'险境模拟',scale:1.15,desc:'更强敌军与额外核心'},extreme:{name:'绝境模拟',scale:1.55,desc:'高强度作战挑战'}};
export const traitText=o=>({acquire:'获得时，自身盟约增加',start:'休整期开始，已激活的自身盟约增加',end:'休整期结束，已激活的自身盟约增加',skill:'释放技能，已激活的自身盟约增加',kill:'击倒敌人，已激活的自身盟约增加',death:'被击倒，已激活的自身盟约增加',refresh:'主动刷新时，已激活的自身盟约增加'}[o.trait]||'已激活的自身盟约增加')+` ${o.traitValue} 层；精锐效果翻倍。`;
