// 盟约黑板键登记表 —— 「原表字段必须有人读」的唯一名单。
//
// 为什么要有这张表：盟约面板过去按 descParamBaseList／descParamPerStackList 逐项显示，
// 战斗侧却把不少数值直接写死在代码里（谢拉格 1.35+0.01×层、维多利亚 1.25+0.008×层、奥术 0.2/0.68、
// 卡西米尔的上限、灵巧的 10+1×层、助力的 +2/+4 与再部署 ×0.7、精准的 0.3 穿透、协防的 1.2/1.4…），
// 于是「面板显示了、改原表不生效」和「原表有值、没人读」两件事都可能悄悄发生。
// 现在原表每个盟约黑板的每个键都必须在这里登记来源与消费者，`tests/native-bond-formula.test.mjs` 会：
//   ① 原表出现的键没登记 → 直接挂；② 登记的键在原表里没了 → 也算挂（防止改表后留死条目）；
//   ③ src:'formula' 的键，键名字符串必须真的出现在某个逻辑模块里（证明是读原表而不是抄了个常量）；
//   ④ src:'zero' 的键，原表值必须是 0（原表为 0 才允许不读）；
//   ⑤ 每一条 descParamPerStackList（原表声明「受层数影响」）都必须是 'formula' 或 'zero'。
//
// src 取值：
//   formula    读原表字段参与结算（本表 ③ 会核对键名出现在逻辑里）
//   activation 激活条件，已由 bondInfoDict.activeParamList／activeConditionTemplate 消费
//   meta       原表的元数据（盟约 id／类型名），不是数值
//   zero       原表值为 0，没有可观测效果
//   client     客户端口径（原表字段无法直接表达，note 必须写清换算方式）
//   text       数值只写在盟约文案里（note 必须引用文案）
//   pending    还没找到消费者或语义待确认（note 必须写清待确认什么）
export const BOND_KEY_REGISTRY={
 yanShip:{
  base_atk:{src:'formula',note:'【炎】干员攻击力提升'},
  atk_per_stack:{src:'formula',note:'每层攻击力提升'},
  power_bond_char_cnt:{src:'formula',note:'炎佑召唤门槛（在场人数）'},
  ex_bond_char_cnt:{src:'formula',note:'9 人强化分支（2 只炎佑、攻击力 1.5 倍）'},
  damage_resistance:{src:'formula',note:'9 人炎佑受伤减免'},
  atk:{src:'formula',note:'9 人炎佑攻击力倍率'}
 },
 sargonShip:{
  base_time:{src:'formula',note:'攻速增益基础持续时间'},
  time_per_stack:{src:'formula',note:'每层持续时间（每层独立计时）'},
  max_buff_stack_cnt:{src:'formula',note:'增益层数上限'},
  base_attack_speed:{src:'formula',note:'每个增益层的攻速'},
  base_atk:{src:'formula',note:'每个增益层的攻击力（≥6 人分支）'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才提供攻击力'},
  valid_in_band:{src:'formula',note:'娜仁图亚策略分支的策略 id'},
  invalid_in_band:{src:'pending',note:'原表与 valid_in_band 同为 band_narant，语义待确认；当前只读 valid_in_band'},
  base_power_time:{src:'formula',note:'策略分支的装备共享时长'},
  power_time_per_stack:{src:'formula',note:'同上，逐层（原表为 0）'},
  filter_item_level:{src:'pending',note:'原表 5；本客户端没有「按装备等级筛选」的消费点'}
 },
 victoriaShip:{
  base_damage_scale:{src:'formula',note:'携带装备的伤害倍率基础'},
  damage_scale_per_stack:{src:'formula',note:'每层伤害倍率'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才加装备攻击力'},
  atk_normal_equip:{src:'formula',note:'普通装备的攻击力提升'},
  atk_golden_equip:{src:'formula',note:'进阶装备的额外提升（基础＋额外）'},
  layer:{src:'formula',note:'每 N 层发一件维式重锤'},
  count:{src:'formula',note:'每次发放件数'},
  pool:{src:'formula',note:'发放的装备池'}
 },
 kjeragShip:{
  base_damage_scale:{src:'formula',note:'对一般敌人的伤害倍率'},
  base_ex_damage_scale:{src:'formula',note:'对寒冷／冻结敌人的伤害倍率基础'},
  ex_damage_scale_per_stack:{src:'formula',note:'对寒冷／冻结敌人每层提升'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才起寒风'},
  'bond_eff_kjerag[storm].interval':{src:'formula',note:'寒风间隔'},
  'bond_eff_kjerag[storm].base_time':{src:'formula',note:'寒风施加寒冷的基础时长'},
  'bond_eff_kjerag[storm].time_per_stack':{src:'formula',note:'寒风时长每层增加（每次起风按当前层数重算）'}
 },
 lateranoShip:{
  base_ammo_percent:{src:'formula',note:'开技弹药量基础提升'},
  ammo_percent_per_stack:{src:'formula',note:'每层弹药量提升'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才有「消耗弹药加攻」'},
  atk_per_consume:{src:'formula',note:'每消耗 1 发弹药的攻击力提升'},
  max_atk_for_consume:{src:'formula',note:'消耗加攻上限'}
 },
 egirShip:{
  base_max_hp:{src:'formula',note:'生命值提升基础'},
  max_hp_per_stack:{src:'formula',note:'每层生命值提升'},
  damage_value:{src:'formula',note:'吞噬造成的生命流失'},
  bond_add_type:{src:'formula',note:'吞噬后按等阶加层（by_charlevel）'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人前几名首次被击倒立即复活'},
  max_free_respawn_cnt:{src:'formula',note:'免费复活人数上限'},
  bond_type:{src:'meta',note:'原表的加层目标类型（bond_by_id）'},
  bond_id:{src:'meta',note:'加层目标盟约 id'}
 },
 siracusaShip:{
  base_attack_speed:{src:'formula',note:'部署后攻速提升基础'},
  attack_speed_per_stack:{src:'formula',note:'每层攻速'},
  base_duration:{src:'formula',note:'攻速／隐匿持续时间基础'},
  duration_per_stack:{src:'formula',note:'每层持续时间'},
  base_damage:{src:'formula',note:'隐匿期间真实伤害基础'},
  damage_per_stack:{src:'formula',note:'每层真实伤害'},
  prob:{src:'formula',note:'真实伤害触发概率；客户端按 bondPityStep 换算成线性递增保底（原表只给概率）'},
  fear:{src:'formula',note:'恐惧时长'},
  end_duration:{src:'formula',note:'脱离隐匿后的窗口时长'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才进入隐匿'},
  ex_bond_char_cnt:{src:'formula',note:'原表第二个在场人数阈值（与 power_bond_char_cnt 同为 6）'}
 },
 kazimierzShip:{
  atk_when_born:{src:'formula',note:'每次部署的攻击力提升'},
  base_max_atk_when_born:{src:'formula',note:'部署加攻上限基础'},
  max_atk_when_born_per_stack:{src:'formula',note:'上限每层提升'},
  damage_interval:{src:'formula',note:'阻挡时周期伤害间隔'},
  damage_atk_scale:{src:'formula',note:'周期真实伤害的攻击力倍率'},
  stun:{src:'formula',note:'周期伤害附带的晕眩时长'},
  range_radius:{src:'formula',note:'周期伤害的圆形半径'},
  pure_atk_scale:{src:'formula',note:'未阻挡时攻击附带的真实伤害倍率'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才有周期伤害'}
 },
 preciShip:{
  base_atk:{src:'formula',note:'攻击力提升基础'},
  atk_per_stack:{src:'formula',note:'每层攻击力提升'},
  power_def_penetrate:{src:'formula',note:'≥N 人的防御穿透比例'},
  power_magic_resist_penetrate:{src:'formula',note:'≥N 人的法抗穿透比例'},
  power_bond_char_cnt:{src:'formula',note:'生效范围扩大到所有远程干员的人数门槛'}
 },
 swiftShip:{
  base_prob:{src:'formula',note:'技能结束回技力概率基础'},
  prob_per_stack:{src:'formula',note:'每层概率'},
  power_bond_stack_cnt:{src:'formula',note:'达到该层数后所有干员额外回技力'},
  normal_sp:{src:'formula',note:'【迅捷】干员回复的技力'},
  power_sp:{src:'formula',note:'达标后所有干员额外回复的技力'}
 },
 skillfulShip:{
  base_attack_speed:{src:'formula',note:'邻近干员攻速加成基础'},
  attack_speed_per_stack:{src:'formula',note:'每层攻速加成'},
  power_bond_stack_cnt:{src:'formula',note:'达到该层数后范围从周围 4 格变 8 格'}
 },
 arcaneShip:{
  base_damage_scale_show:{src:'formula',note:'法术脆弱基础（显示值）'},
  damage_scale_per_stack:{src:'formula',note:'每层法术脆弱'},
  base_damage_scale_show_ex:{src:'formula',note:'生命低于阈值时的法术脆弱基础'},
  damage_scale_per_stack_show_ex:{src:'formula',note:'生命低于阈值时每层法术脆弱'},
  base_damage_scale:{src:'client',note:'＝1+base_damage_scale_show；客户端统一用 _show 项表达脆弱比例'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才启用低血量分支'},
  hp_ratio:{src:'formula',note:'低血量分支的生命比例阈值'},
  weak_duration:{src:'formula',note:'法术脆弱持续时间'},
  power_weak_scale:{src:'pending',note:'原表 1.4；客户端低血量分支用的是 base_damage_scale_show_ex=0.68，1.4 与 0.2×1.4=0.28 都对不上，语义待确认'}
 },
 steadShip:{
  base_max_hp:{src:'formula',note:'生命值提升基础'},
  max_hp_per_stack:{src:'formula',note:'每层生命值提升'},
  base_damage_value:{src:'formula',note:'反击法术伤害基础'},
  damage_value_per_stack:{src:'formula',note:'每层反击伤害'},
  damage_resistance:{src:'formula',note:'非【坚守】干员伤害由坚守分摊的比例'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才分摊／反击'},
  cd_duration:{src:'formula',note:'反击触发间隔'},
  'weak[limit]':{src:'formula',note:'反击附带的脆弱持续时间（原表键名含 [limit]）'},
  damage_scale:{src:'formula',note:'反击附带的脆弱倍率'}
 },
 deputShip:{
  base_def:{src:'formula',note:'防御力提升基础'},
  def_per_stack:{src:'formula',note:'每层防御力提升'},
  respawn_time:{src:'formula',note:'再部署时间减少比例（原表为负值）'},
  layer:{src:'formula',note:'休整期结束给所有已激活盟约加的层数'},
  count:{src:'formula',note:'达到该在场人数改用 more_layer'},
  more_layer:{src:'formula',note:'人数达标后加的层数'},
  bond:{src:'meta',note:'加层目标盟约 id'}
 },
 visiShip:{
  layer:{src:'formula',note:'每 N 层发一次资金'},
  count:{src:'formula',note:'每次发放的资金'},
  layer1:{src:'formula',note:'首个永久折扣阈值'},
  layer2:{src:'formula',note:'折扣作用范围扩大到全部干员的阈值'},
  discount:{src:'formula',note:'每档折扣金额（作用范围由客户端档位编码，见 BOND_TEXT_CONSTANTS.visiShip）'},
  bond:{src:'meta',note:'折扣目标盟约 id'}
 },
 miraShip:{
  baseprob:{src:'formula',note:'刷新免费概率基础'},
  prob:{src:'formula',note:'每层免费概率'},
  layer:{src:'formula',note:'每 N 层发一次资金'},
  count:{src:'formula',note:'每次发放的资金'},
  probk:{src:'pending',note:'原表 0.3；客户端没有消费点，语义待确认（当前只用 baseprob+prob×层）'}
 },
 investShip:{
  event:{src:'formula',note:'加倍触发的事件类型（SERVER_GAIN）'},
  count:{src:'formula',note:'每次触发的次数'},
  layer:{src:'zero',note:'原表为 0：阈值只写在文案里，见 BOND_TEXT_CONSTANTS.investShip.powerLayer'}
 },
 raidShip:{
  base_atk:{src:'formula',note:'再部署期间攻击力提升基础'},
  atk_per_stack:{src:'formula',note:'每层攻击力提升'},
  base_max_hp:{src:'formula',note:'再部署期间生命值提升基础（原表未列入 descParamBaseList，面板用 BOND_PANEL_EXTRA 补显示）'},
  max_hp_per_stack:{src:'formula',note:'每层生命值提升'},
  power_bond_stack_cnt:{src:'formula',note:'达到该层数给全体加攻速'},
  power_attack_speed:{src:'formula',note:'达标后的全体攻速加成'},
  no_attack_duration:{src:'formula',note:'未攻击多少秒后触发再部署'},
  base_attack_speed:{src:'zero',note:'原表为 0：逐层攻速加成为 0，无可观测效果'},
  attack_speed_per_stack:{src:'zero',note:'原表为 0，同上'}
 },
 indomShip:{
  base_prob:{src:'formula',note:'被击倒后保留部署概率基础'},
  prob_per_stack:{src:'formula',note:'每层概率'},
  sp:{src:'formula',note:'≥N 人时全场回技力'},
  power_bond_char_cnt:{src:'formula',note:'≥N 人才回技力'},
  power_bond_stack_cnt:{src:'zero',note:'原表为 0：回技力没有层数门槛，门槛用的是在场人数'}
 },
 maniShip:{
  count:{src:'formula',note:'核心盟约激活人数 +N'}
 },
 emptyShip:{
  damage_resistance:{src:'formula',note:'全体受到的物理／法术伤害减免'},
  damage_scale_normal:{src:'formula',note:'【协防】干员伤害倍率'},
  damage_scale_extra:{src:'formula',note:'精锐【协防】干员伤害倍率'}
 },
 soloShip:{
  atk:{src:'formula',note:'攻击力提升'},
  max_hp:{src:'formula',note:'生命值提升'},
  sp:{src:'formula',note:'初始技力增加'}
 },
 suntShip:{
  ex_char_cnt:{src:'formula',note:'≥N 名精锐才减技力消耗'},
  power_atk:{src:'formula',note:'精锐干员攻击力提升'},
  sp_ratio:{src:'formula',note:'技力消耗乘数'},
  power_char_cnt:{src:'activation',note:'激活门槛（＝activeParamList[0]，激活模板 count_threshold_upward_golden）'}
 }
};

// 只写在盟约文案里的数字：原表黑板没有对应字段，只能登记在这里，改文案时同步这里。
export const BOND_TEXT_CONSTANTS=Object.freeze({
 yanShip:Object.freeze({
  guardianShare:0.3,
  guardianTargets:3,
  note:'文案：炎佑的攻击力生命值分别为开战时【炎】干员攻击力生命值总和的30%，同时攻击3个目标'
 }),
 investShip:Object.freeze({
  powerLayer:100,
  powerCountAdd:1,
  note:'文案：达到100层后“获得时”类特质每次触发3次；原表该行 layer=0，没有阈值字段'
 }),
 visiShip:Object.freeze({
  discountAmount:1,
  note:'文案：永久-1资金；permanentDiscount=1 表示只作用于【远见】干员、=2 表示调度中心内所有干员（客户端用档位编码作用范围）'
 })
});

// 待确认项必须与测试里冻结的名单一致，新增一条就要在测试里显式加一条。
export const BOND_KEY_PENDING=Object.freeze([
 'sargonShip.invalid_in_band','sargonShip.filter_item_level','arcaneShip.power_weak_scale','miraShip.probk'
].sort());

export function bondValueEntries(data,bondId){
 const info=data.season.bondInfoDict?.[bondId],values={};
 for(const row of data.season.effectBuffInfoDataDict?.[info?.effectId]||[])for(const r of row.blackboard||[])if(r.key!=='key'&&values[r.key]===undefined)values[r.key]=r.valueStr??r.value;
 return values;
}
// 审计：返回未登记／已失效／zero 不符／缺说明的条目，测试直接断言四项都为空。
export function bondKeyAudit(data){
 const seen=new Set(),missing=[],stale=[],badZero=[],badNote=[];
 for(const [bondId,info] of Object.entries(data.season.bondInfoDict||{})){
  if(!info?.effectId)continue;
  for(const [key,value] of Object.entries(bondValueEntries(data,bondId))){
   seen.add(bondId+'.'+key);
   const entry=(BOND_KEY_REGISTRY[bondId]||{})[key];
   if(!entry){missing.push({bondId,key,value});continue;}
   if(entry.src==='zero'&&Number(value)!==0)badZero.push({bondId,key,value});
   if(['pending','text','client'].includes(entry.src)&&!entry.note)badNote.push({bondId,key,src:entry.src});
  }
 }
 for(const [bondId,keys] of Object.entries(BOND_KEY_REGISTRY))for(const key of Object.keys(keys))if(!seen.has(bondId+'.'+key))stale.push({bondId,key});
 return {missing,stale,badZero,badNote};
}
