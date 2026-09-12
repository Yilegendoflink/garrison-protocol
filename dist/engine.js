import {createTrainingDummy,dummySummary} from './benchmark.js';
import {shouldAutoSkill,baseFunding} from './protocol.js';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges,wakeOnHit} from './status.js';
import {LEGACY_CONTENT,validateContent} from './content.js';
import {FPS,attribute,attackTiming,damage,applyDamage,recoverHP,gainSP,spendSP,spCapacity} from './combat.js';
import {rotateCells,containsTarget,selectEnemies,selectAllies,selectDefender} from './targeting.js';
import {startAttack,advanceAttack,cancelAttack} from './actions.js';

export class Game {
 constructor(seed=Date.now(),content=LEGACY_CONTENT){
  const errors=validateContent(content);if(errors.length)throw Error(errors.join('; '));this.content=content;
  this.onChange=()=>{};this.onEffect=()=>{};this.onNotice=()=>{};
  this.s={contentId:content.id,contentVersion:content.version,version:this.content.VERSION,seed:seed>>>0,seq:0,phase:'briefing',round:1,level:1,discount:0,money:3,hp:30,maxHp:30,cap:8,strategy:content.STRATEGIES[0].id,difficulty:Object.keys(content.DIFFICULTIES)[0],map:0,units:[],items:[],shop:[],locked:false,stacks:{},decisions:[],promotionQueue:[],rewardOffers:null,decisionOffers:null,logs:[],battle:null,stats:{kills:0,leaks:0,merges:0,bought:0,spent:0,rounds:0,time:0,damage:{},healing:{}},skillPrefs:{},won:false,hidden:false,bonusFunds:0,freeRefresh:0,refreshCount:0,lastResult:null};
 }
 random(channel='battle'){this.s.randomSeeds??={battle:(this.s.seed||1),economy:((this.s.seed^0x9e3779b9)>>>0)||1};let x=this.s.randomSeeds[channel]||1;x^=x<<13;x^=x>>>17;x^=x<<5;this.s.randomSeeds[channel]=x>>>0;return this.s.randomSeeds[channel]/4294967296;}
 pick(a,channel='economy'){return a[Math.floor(this.random(channel)*a.length)];}
 uid(){return ++this.s.seq;}
 notify(msg){this.onNotice(msg);return false;}
 log(msg){this.s.logs.unshift({round:this.s.round,text:msg});this.s.logs=this.s.logs.slice(0,60);}
 changed(){this.onChange();}
 get map(){return this.content.MAPS[this.s.map];}
 get onField(){return this.s.units.filter(u=>u.x!==null);}
 get hand(){return [...this.s.units.filter(u=>u.x===null),...this.s.items];}
 get strategy(){return this.content.STRATEGIES.find(x=>x.id===this.s.strategy);}
 get wave(){return this.content.WAVES[this.s.round-1];}
 get upgradeCost(){return this.s.level>=6?0:Math.max(0,[0,5,7,8,10,12][this.s.level]-this.s.discount);}
 get shopSlots(){return Math.min(6,3+Math.floor(this.s.level/2));}
 get recruitCost(){return this.active('insight')&&this.stack('insight')>=100?2:3;}
 stack(id){return this.s.stacks[id]||0;}
 has(id){return this.s.decisions.filter(x=>x===id).length;}
 allies(){const counts={};for(const u of this.onField){for(const a of this.content.OP[u.id].alliances){(counts[a]??=new Set()).add(u.id);}}return Object.fromEntries(Object.entries(this.content.ALLIANCES).map(([id,a])=>[id,{...a,id,count:counts[id]?.size||0,active:(counts[id]?.size||0)>=a.need,stacks:this.stack(id)}]));}
 active(id){let ids=new Set(this.onField.filter(u=>this.content.OP[u.id].alliances.includes(id)).map(u=>u.id));return ids.size>=(this.content.ALLIANCES[id]?.need??99);}
 addStacks(id,n){this.s.stacks[id]=Math.min(9999,this.stack(id)+n);}
 trait(u,event){const o=this.content.OP[u.id];if(o.trait!==event)return;if((event==='skill'||event==='kill'||event==='refresh')&&u.traitTriggers>=10)return;let hit=false;for(const a of o.alliances){if(event==='acquire'||this.active(a)){this.addStacks(a,o.traitValue*(u.elite?2:1));hit=true;}}if(hit)u.traitTriggers=(u.traitTriggers||0)+1;}
 setPreferences({difficulty,map,strategy}){if(this.s.phase!=='briefing')return false;if(this.content.DIFFICULTIES[difficulty])this.s.difficulty=difficulty;if(this.content.MAPS[map])this.s.map=map;if(this.content.STRATEGIES.some(s=>s.id===strategy))this.s.strategy=strategy;this.changed();return true;}
 start(){if(this.s.phase!=='briefing')return false;this.s.hp=this.s.maxHp=this.strategy.hp;this.s.phase='prep';this.enterPrep(true);this.s.shop=(this.content.startingShop||this.content.OPERATORS.filter(o=>o.tier===1).slice(0,3).map(o=>o.id)).map(id=>({kind:'op',id}));this.log('调度中心已接入。招募干员，建立第一道防线。');this.changed();return true;}
 enterPrep(first=false){
  this.s.phase='prep';this.s.baseFunds=baseFunding(this.s.round);this.s.money=this.s.baseFunds+this.strategy.money+this.has('funding')*2+this.s.bonusFunds;
  if(this.active('victoria'))this.s.money+=Math.floor(this.stack('victoria')/15);this.s.bonusFunds=0;
  if(!first)this.s.discount++;this.s.hp=Math.min(this.s.maxHp,this.s.hp+this.has('medical'));
  this.s.freeRefresh=this.active('insight')?Math.min(8,Math.floor(this.stack('insight')/20)):0;this.s.refreshCount=0;
  this.s.battle=null;for(const u of this.s.units){u.traitTriggers=0;this.trait(u,'start');}
  this.fillShop(!this.s.locked);this.s.locked=false;
 }
 rollOffer(tier=this.s.level,onlyOps=false){
  if(!onlyOps&&this.random('economy')<.16){const pool=this.content.EQUIPMENT.filter(e=>e.tier<=tier);return {kind:'equipment',id:this.pick(pool).id};}
  const pool=this.content.OPERATORS.filter(o=>o.tier<=tier);
  // Higher tiers remain mixed with earlier tiers, so pairs remain available after upgrading.
  const weights=pool.map(o=>Math.pow(.72,tier-o.tier));let r=this.random('economy')*weights.reduce((a,b)=>a+b,0);
  let o=pool.at(-1);for(let i=0;i<pool.length;i++){r-=weights[i];if(r<=0){o=pool[i];break;}}
  return {kind:'op',id:o.id};
 }
 fillShop(reset=true){const old=this.s.shop;this.s.shop=Array.from({length:this.shopSlots},(_,i)=>!reset&&old[i]?old[i]:this.rollOffer());}
 canManage(){return this.s.phase==='prep'&&!this.s.rewardOffers&&!this.s.decisionOffers;}
 cost(offer){return offer.kind==='op'?Math.max(0,(this.content.purchasePrices?.[this.content.OP[offer.id].tier]??3)-(3-this.recruitCost)):this.content.EQ[offer.id]?.cost||3;}
 canGainOp(id){return this.hand.length<10||this.s.units.filter(u=>u.id===id&&!u.elite).length>=2;}
 buy(index){
  if(!this.canManage())return this.notify('请先完成当前决策。');const offer=this.s.shop[index];if(!offer)return false;const cost=this.cost(offer);
  if(this.s.money<cost)return this.notify('资金不足。');
  if(offer.kind==='op'?!this.canGainOp(offer.id):this.hand.length>=10&&!this.hasBaseEquipment(offer.id))return this.notify('整备区已满，请先部署或出售干员。');
  this.s.money-=cost;this.s.stats.spent+=cost;this.s.shop[index]=null;
  if(offer.kind==='op'){this.gainOp(offer.id);this.s.stats.bought++;}else this.gainEquipment(offer.id);
  this.changed();return true;
 }
 gainOp(id,elite=false){
  if(!this.content.OP[id])return null;const u={uid:this.uid(),id,kind:'op',elite,x:null,y:null,dir:0,equipment:[],skill:this.s.skillPrefs[id]||0,traitTriggers:0};this.s.units.push(u);this.trait(u,'acquire');
  this.log(`${this.content.OP[id].name}加入整备${elite?' · 精锐':''}`);this.mergeOps(id);return u;
 }
 mergeOps(id){let copies=this.s.units.filter(u=>u.id===id&&!u.elite);while(copies.length>=3){
  const group=copies.slice(0,3),field=group.find(u=>u.x!==null),anchor=field||group[0];
  for(const u of group){for(const e of u.equipment)this.s.items.push({...e,kind:'equipment'});}
  const ids=new Set(group.map(x=>x.uid));this.s.units=this.s.units.filter(u=>!ids.has(u.uid));
  const merged={...anchor,uid:this.uid(),elite:true,equipment:[],traitTriggers:0};this.s.units.push(merged);this.s.stats.merges++;this.log(`${this.content.OP[id].name}晋升精锐，获得晋升调配特许`);this.queuePromotion(Math.min(6,this.s.level+1));this.onEffect({type:'merge',x:merged.x,y:merged.y});copies=this.s.units.filter(u=>u.id===id&&!u.elite);
 }}
 queuePromotion(tier){this.s.promotionQueue.push(tier);this.refreshReward();}
 refreshReward(){if(this.s.rewardOffers||!this.s.promotionQueue.length)return;let tier=this.s.promotionQueue[0];let pool=this.content.OPERATORS.filter(o=>o.tier===tier);const choices=[];while(choices.length<Math.min(3,pool.length)){let chosen=this.pick(pool);choices.push({kind:'op',id:chosen.id});pool=pool.filter(o=>o.id!==chosen.id);}this.s.rewardOffers=choices;}
 takePromotion(index){const offer=this.s.rewardOffers?.[index];if(!offer||this.s.phase!=='prep')return false;this.s.rewardOffers=null;this.s.promotionQueue.shift();this.gainOp(offer.id);this.refreshReward();this.changed();return true;}
 hasBaseEquipment(id){return this.s.items.some(e=>e.kind==='equipment'&&e.id===id&&!e.elite)||this.s.units.some(u=>u.equipment.some(e=>e.id===id&&!e.elite));}
 gainEquipment(id,elite=false){const e={uid:this.uid(),kind:'equipment',id,elite};this.s.items.push(e);this.mergeEquipment(id);this.log(`获得装备：${this.content.EQ[id].name}`);return e;}
 mergeEquipment(id){const list=[];for(const e of this.s.items){if(e.kind==='equipment'&&e.id===id&&!e.elite)list.push({e,owner:null});}for(const u of this.s.units)for(const e of u.equipment)if(e.id===id&&!e.elite)list.push({e,owner:u});
  if(list.length<2)return;for(const {e,owner} of list.slice(0,2)){if(owner)owner.equipment=owner.equipment.filter(x=>x.uid!==e.uid);else this.s.items=this.s.items.filter(x=>x.uid!==e.uid);}this.s.items.push({uid:this.uid(),kind:'equipment',id,elite:true});this.log(`${this.content.EQ[id].name}合成为进阶装备`);this.mergeEquipment(id);
 }
 gainSpell(id){this.s.items.push({uid:this.uid(),kind:'spell',id});}
 equip(itemUid,unitUid,replaceIndex=null){if(!this.canManage())return false;const item=this.s.items.find(e=>e.uid===itemUid&&e.kind==='equipment'),u=this.s.units.find(u=>u.uid===unitUid);if(!item||!u)return false;if(u.equipment.length>=2){if(replaceIndex===null)return 'replace';if(!u.equipment[replaceIndex])return false;u.equipment.splice(replaceIndex,1);}this.s.items=this.s.items.filter(e=>e.uid!==itemUid);u.equipment.push(item);this.log(`${this.content.OP[u.id].name}装备${this.content.EQ[item.id].name}`);this.changed();return true;}
 useSpell(uid,target=null){if(!this.canManage())return false;const item=this.s.items.find(e=>e.uid===uid&&e.kind==='spell');if(!item)return false;const spell=this.content.SP[item.id];if(spell.effect==='elite'){const u=this.s.units.find(u=>u.uid===target);if(!u)return 'target';if(u.elite)return this.notify('该干员已经是精锐。');u.elite=true;for(const e of u.equipment)this.s.items.push(e);u.equipment=[];this.s.stats.merges++;this.queuePromotion(Math.min(6,this.s.level+1));}
  else if(spell.effect==='hp')this.s.hp=Math.min(this.s.maxHp,this.s.hp+spell.value);else if(spell.effect==='money')this.s.money+=spell.value;this.s.items=this.s.items.filter(e=>e.uid!==uid);this.log(`使用${spell.name}`);this.changed();return true;
 }
 refresh(){if(!this.canManage())return false;if(this.s.freeRefresh>0)this.s.freeRefresh--;else{if(this.s.money<1)return this.notify('刷新需要 1 资金。');this.s.money--;this.s.stats.spent++;}this.s.locked=false;this.fillShop(true);this.s.refreshCount++;for(const u of this.s.units)this.trait(u,'refresh');this.changed();return true;}
 upgrade(){if(!this.canManage()||this.s.level>=6)return false;const price=this.upgradeCost;if(this.s.money<price)return this.notify(`升级需要 ${price} 资金。`);this.s.money-=price;this.s.stats.spent+=price;this.s.level++;this.s.discount=0;while(this.s.shop.length<this.shopSlots)this.s.shop.push(this.rollOffer());this.log(`调度中心升至 ${this.s.level} 级，解锁更高等阶`);this.changed();return true;}
 lock(){if(!this.canManage())return false;this.s.locked=!this.s.locked;this.changed();return true;}
 tile(x,y){if(x<0||x>=this.map.cols||y<0||y>=this.map.rows)return 'outside';if(this.map.blocked.some(p=>p[0]===x&&p[1]===y))return 'blocked';if(this.map.paths.some(p=>(p[0][0]===x&&p[0][1]===y)||(p.at(-1)[0]===x&&p.at(-1)[1]===y)))return 'portal';return this.map.high.some(p=>p[0]===x&&p[1]===y)?'high':'ground';}
 canPlace(u,x,y){const t=this.tile(x,y);return t!=='blocked'&&t!=='outside'&&t!=='portal'&&(t!=='high'||this.content.OP[u.id].placement!=='melee');}
 deploy(uid,x,y,dir=null){if(dir!==null&&(!Number.isInteger(dir)||dir<0||dir>3))return false;if(!this.canManage())return false;const u=this.s.units.find(u=>u.uid===uid);if(!u)return false;if(!this.canPlace(u,x,y))return this.notify('该位置无法部署此干员。近战干员不能部署至高台。');const other=this.s.units.find(v=>v.x===x&&v.y===y&&v.uid!==uid);
  if(u.x===null&&!other&&this.onField.length>=this.s.cap)return this.notify(`已达到 ${this.s.cap} 个部署位上限。`);
  if(other){if(u.x===null){other.x=null;other.y=null;}else {if(!this.canPlace(other,u.x,u.y))return this.notify('交换后干员无法部署至原地块。');other.x=u.x;other.y=u.y;}}
  u.x=x;u.y=y;if(dir!==null)u.dir=dir;this.changed();return true;
 }
 withdraw(uid){if(!this.canManage())return false;const u=this.s.units.find(u=>u.uid===uid);if(!u||u.x===null)return false;if(this.hand.length>=10)return this.notify('整备区已满。');u.x=null;u.y=null;this.changed();return true;}
 turn(uid,dir=null){if(!this.canManage())return false;const u=this.s.units.find(u=>u.uid===uid);if(!u)return false;u.dir=dir??((u.dir+1)%4);this.changed();return true;}
 sell(uid){if(!this.canManage())return false;const u=this.s.units.find(u=>u.uid===uid);if(u){this.s.units=this.s.units.filter(x=>x.uid!==uid);this.s.items.push(...u.equipment);this.s.money++;this.log(`出售${this.content.OP[u.id].name} · +1 资金`);}else{const e=this.s.items.find(x=>x.uid===uid);if(!e)return false;this.s.items=this.s.items.filter(x=>x.uid!==uid);this.log(`销毁${(this.content.EQ[e.id]||this.content.SP[e.id]).name}`);}this.changed();return true;}
 attributes(u,combat=null){const o=this.content.OP[u.id],m=u.elite?1.8:1,a=this.allies(),gear={atk:0,hp:0,def:0,res:0,speed:0,sp:0,regen:0,redeploy:0,initialSP:0};for(const item of u.equipment){let e=this.content.EQ[item.id],q=(item.elite?2:1)*(a.columbia.active?1.25:1);for(const k in gear)gear[k]+=(e[k]||0)*q;}
  const universal=(this.s.strategy==='perfect'?.2:0)+this.has('flawless')*.1,rh=a.rhodes.active?a.rhodes.stacks:0,yan=a.yan.active?a.yan.stacks:0,firm=a.firm.active?a.firm.stacks:0;
  const skill=this.skill(u),active=combat?.active>0,status= statusAttributeChanges(combat||{});let hp=attribute(o.hp*m,{ratio:gear.hp+universal+rh*.005+(o.alliances.includes('aegir')&&a.aegir.active?a.aegir.stacks*.01:0),min:1});
  let atk=attribute(o.atk*m,{ratio:gear.atk+universal+rh*.0025+(a.assault.active?.08:0)+(active&&['buff','heal'].includes(skill.type)&&!skill.attackScale?(skill.power-1):0)});
  let def=attribute(o.def*m,{ratio:gear.def+universal+yan*.007+(a.firm.active?.1+firm*.006:0)+(active?(skill.type==='defense'?skill.power-1:Math.max(0,(skill.def||1)-1)):0)+(combat?.armorBuff>0?.8:0),scales:active&&skill.def<1?[skill.def]:[]});
  return {hp,atk,def,res:Math.min(100,Math.max(0,o.res+gear.res+Math.floor(yan/20)*5+(combat?.resBuff>0?40:0)+status.resistance)),speed:Math.max(.2,1+status.attackSpeed/100+(active?(skill.speed||1)-1:0)+gear.speed+this.has('flawless')*.1+(a.swift.active?.1+a.swift.stacks*.006:0)+(o.placement==='ranged'&&a.laterano.active?a.laterano.stacks*.008:0)),sp:1+gear.sp+this.has('research')*.25+(a.miracle.active?a.miracle.stacks*.008:0),regen:gear.regen+(o.regen||0)+(o.alliances.includes('aegir')&&a.aegir.active?.003:0),redeploy:Math.max(3,o.redeploy*(1-Math.min(.85,gear.redeploy+this.has('research')*.2+(a.assault.active?Math.min(.6,a.assault.stacks*.008):0)))),dp:Math.max(1,Math.round(o.dp*(1-Math.min(.7,gear.redeploy)))),block:o.block+(o.cls==='defender'&&a.firm.active&&firm>=30?1:0),initialSP:gear.initialSP};
 }
 skill(u){return this.content.OP[u.id].skills[u.skill??u.skillIndex??0]||this.content.OP[u.id].skills[0];}
 rangeExtra(u){const active=this.s.battle?.units.find(v=>v.uid===u.uid)?.active>0,skill=this.skill(u);return active?(skill.range||(['heal','sanctuary'].includes(skill.type)?1:0)):0;}
 rangeCells(u,extra=0){const o=this.content.OP[u.id],skill=this.skill(u);if(extra&&skill.rangeCells)return rotateCells(skill.rangeCells,u);if(!extra)return rotateCells(o.rangeCells,u);const cells=[];for(const [x,y] of o.rangeCells)for(let i=0;i<=extra;i++)cells.push([x+i,y]);return rotateCells([...new Map(cells.map(p=>[p.join(','),p])).values()],u);}
 inRange(u,target,extra=0){return containsTarget(this.rangeCells(u,extra),target);}
 startBenchmark(){return this.startBattle(true);}
 startBattle(forceBenchmark=false){if(!this.canManage())return false;if(!this.onField.length)return this.notify('请先从整备区选择干员，部署到战场。');
  for(const u of this.onField)this.trait(u,'end');if(this.has('union'))for(const a of Object.values(this.allies()))if(a.active)this.addStacks(a.id,3*this.has('union'));
  const overflow=this.hand.slice(10);for(const item of overflow){if(item.kind==='op'){this.s.units=this.s.units.filter(u=>u.uid!==item.uid);}else this.s.items=this.s.items.filter(e=>e.uid!==item.uid);}if(overflow.length)this.log(`临时整备区的 ${overflow.length} 件物资已清空`);
  this.s.money=0;if(!this.s.locked)this.s.shop=[];this.s.phase='battle';let [,type,count]=this.wave;const queue=[];const gap=this.s.round<=2?4.2:Math.max(.85,2.2-this.s.round*.05);
  for(let i=0;i<count;i++)queue.push({type,lane:this.s.round<=2?0:i%2,at:3+i*gap,bounty:false});
  if(this.s.round>=8&&this.s.round<16)for(let i=0;i<Math.floor(this.s.round/5);i++)queue.push({type:'guard',lane:i%2,at:6+i*4,bounty:false});
  if(this.has('bounty'))for(let i=0;i<2;i++)queue.push({type:'breaker',lane:i,at:7+i*5,bounty:true});
  const units=this.onField.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map((u,i)=>{const stats=this.attributes(u);return {uid:u.uid,id:u.id,x:u.x,y:u.y,dir:u.dir,elite:u.elite,skillIndex:u.skill,stats,hp:stats.hp,maxHp:stats.hp,sp:Math.min(spCapacity(this.skill(u)),stats.initialSP+(this.skill(u).initialSP||0)),spLock:0,action:null,attackCooldown:0,cd:0,active:0,down:0,deployAt:(this.content.deploymentDelay??1)+i*(this.content.deploymentStagger??.18),deployed:false,skillCount:0,damage:0,healing:0,shield:0,statuses:[],immunities:this.content.OP[u.id].immunities||{},armorBuff:0,resBuff:0,traitTriggers:0};});
  this.s.battle={rulesVersion:2,tickRemainder:0,projectiles:[],time:0,units,enemies:[],queue:queue.sort((a,b)=>a.at-b.at),spawned:0,total:queue.length,kills:0,leaks:0,bountyKills:0,dp:20,limit:this.s.round>=16?140:90,escalation:1,pulse:0,bossPulse:0,wallUsed:false,drone:null,startingHp:this.s.hp};
  if(forceBenchmark||(this.s.round>=16&&this.content.finalPhase?.kind==='training-dummy')){const b=this.s.battle;b.queue=[];b.total=1;b.spawned=1;b.enemies=[createTrainingDummy(this.uid(),5,1)];b.limit=this.content.finalPhase?.duration??150;b.benchmark={duration:b.limit,elapsedFrames:0};this.s.benchmarkResult=null;this.log('木桩测试开始 · '+b.limit+' 秒 · 可手动结束');this.changed();return true;}
  this.log(`第 ${this.s.round} 轮作战开始 · ${this.wave[0]}`);this.changed();return true;
 }
 spawnEnemy(q){const base=this.content.ENEMIES[q.type],round=this.s.round,scale=this.content.DIFFICULTIES[this.s.difficulty].scale*(1+Math.max(0,round-3)*.055),path=this.map.paths[q.lane%this.map.paths.length];let hp=base.hp*scale;const enemy={...base,uid:this.uid(),type:q.type,x:path[0][0],y:path[0][1],path:q.lane%this.map.paths.length,segment:0,hp,maxHp:hp,atk:base.atk*scale,def:base.def*(1+Math.max(0,round-5)*.025),shield:base.shield?base.shield*scale:0,maxShield:base.shield?base.shield*scale:0,action:null,attackCooldown:0,spLock:0,cd:.7,stun:0,slowUntil:0,slow:1,block:null,bounty:!!q.bounty,armorBreak:0,debuff:0,vulnerable:1,bossClock:0,spawnedAt:this.s.battle.time};this.s.battle.enemies.push(enemy);this.s.battle.spawned++;return enemy;}
 castSkill(uid){if(this.s.phase!=='battle')return false;const source=this.s.units.find(u=>u.uid===uid),bu=this.s.battle.units.find(u=>u.uid===uid);if(!source||!bu||this.skill(source).activation!=='manual')return false;const o=this.content.OP[source.id],targets=selectEnemies(bu,this.s.battle.enemies,{cells:this.rangeCells(source,this.rangeExtra(source)),paths:this.map.paths,antiAir:o.placement!=='melee'||o.antiAir,priority:o.targetPriority,canTargetSleeping:!!o.canTargetSleeping});return this.triggerSkill(bu,source,targets);}
 triggerSkill(bu,source,targets){const skill=this.skill(source);if(!permissions(bu).skill||bu.stun>0||!spendSP(bu,skill))return false;bu.lastSkillOperation=this.s.battle.time;bu.toggleUsed=!!skill.toggle;cancelAttack(bu);bu.skillCount++;bu.active=skill.permanentSecond&&bu.skillCount>=2?999:skill.duration;this.trait(source,'skill');
  if(skill.dp)this.s.battle.dp=Math.min(99,this.s.battle.dp+skill.dp);
  this.onEffect({type:'skill',x:bu.x,y:bu.y,text:skill.name,color:'#eac873'});
  const nearby=this.s.battle.enemies.filter(e=>e.hp>0&&Math.hypot(e.x-bu.x,e.y-bu.y)<3);
  if(skill.type==='dp')this.s.battle.dp=Math.min(99,this.s.battle.dp+skill.power);
  if(skill.type==='stun')for(const e of nearby){applyStatus(e,'stun',3,{source:bu.uid});for(let i=0;i<(skill.hits||1);i++)this.hit(bu,source,e,bu.stats.atk*skill.power,'arts');}
  if(skill.type==='pull')for(const e of targets.slice(0,3)){applyStatus(e,'stun',2,{source:bu.uid});this.hit(bu,source,e,bu.stats.atk*skill.power,'true');if(!e.trainingDummy&&!e.boss&&!['armor','golem'].includes(e.type)){const p=this.map.paths[e.path];e.segment=Math.min(p.length-2,e.segment+1);e.x=p[e.segment][0];e.y=p[e.segment][1];}}
  if(skill.type==='burst'){let all=targets.length?targets:nearby;if(skill.hits&&source.id==='chen'){for(let i=0;i<skill.hits;i++){let valid=all.filter(e=>e.hp>0);if(!valid.length)break;let e=valid[i%valid.length];this.hit(bu,source,e,bu.stats.atk*skill.power,'physical');e.stun=3;}}else{let main=all[0];if(main){const victims=skill.aoe?this.s.battle.enemies.filter(e=>Math.hypot(e.x-main.x,e.y-main.y)<=skill.aoe):[main];for(const e of victims){for(let i=0;i<(skill.hits||1);i++)this.hit(bu,source,e,bu.stats.atk*skill.power,'physical');if(source.id==='meteorite')e.armorBreak=120;}}}}
  if(skill.type==='selfheal'||skill.type==='groupheal'){let allies=this.s.battle.units.filter(u=>u.hp>0&&u.deployed&&Math.hypot(u.x-bu.x,u.y-bu.y)<=2.5).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp);if(skill.type==='selfheal')allies=allies.slice(0,1);for(const a of allies)this.heal(bu,a,bu.stats.atk*skill.power);}
  if(skill.type==='drone'){let allies=this.s.battle.units.filter(u=>u.hp>0&&u.deployed).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp);if(allies.length)this.s.battle.drone={x:allies[0].x,y:allies[0].y,time:skill.duration,power:bu.stats.atk*skill.power,owner:bu.uid};}return true;
 }
 heal(source,target,amount){if(!target.deployed||target.unhealable)return;const mult=this.active('columbia')?1+this.stack('columbia')*.007:1;const real=recoverHP(target,damage({amount,type:'healing',multiplier:mult*(target.healingReceived??1)}));source.healing+=real;this.s.stats.healing[source.id]=(this.s.stats.healing[source.id]||0)+real;if(real>15)this.onEffect({type:'heal',x:target.x,y:target.y,value:Math.round(real),from:[source.x,source.y]});}
 hit(bu,source,e,amount,type){if(e.hp<=0||e.invulnerable)return;const o=this.content.OP[source.id];if(permissions(e).sleeping&&!o.canDamageSleeping)return;const def=attribute(e.def,{ratio:-(e.debuff||0),finalAdd:-(e.armorBreak||0)}),res=Math.max(0,e.res-(e.debuff?15:0)+statusAttributeChanges(e).resistance);const physical=damage({amount,defense:def,penetration:(o.physicalPenetration||0)+(o.cls==='sniper'&&this.active('precise')?30+this.stack('precise')*3:0),penetrationRatio:o.physicalPenetrationRatio||0}),arts=damage({amount,type:'arts',resistance:res,penetration:(o.artsPenetration||0)+(this.active('arcane')?this.stack('arcane')*.2:0),penetrationRatio:o.artsPenetrationRatio||0});if(type!=='true'&&type!=='elemental'&&this.s.strategy==='adaptive'&&o.placement==='ranged')type=physical>arts?'physical':'arts';
  let dealt=type==='elemental'?damage({amount,type,elementResistance:e.elementResistance||0}):type==='true'?amount:type==='arts'?arts:physical;
  if(type==='arts'&&this.active('arcane'))dealt*=1+this.stack('arcane')*.008;
  if(type==='physical'&&o.alliances.includes('victoria')&&this.active('victoria'))dealt*=1+this.stack('victoria')*.008;
  if(o.alliances.includes('siracusa')&&this.active('siracusa')&&this.random()<Math.min(.8,this.stack('siracusa')*.006))dealt*=1.75;
  if(o.alliances.includes('kjerag')&&this.active('kjerag')){e.slowUntil=this.s.battle.time+2;e.slow=.55;dealt*=1+this.stack('kjerag')*.01;}
  dealt*=e.vulnerable;const applied=applyDamage(e,dealt*(1-(e.damageReduction||0)),{type,sourceId:source.id,sourceUid:source.uid});wakeOnHit(e);const shieldDamage=applied.shield,real=applied.hp;bu.damage+=real+shieldDamage;this.s.stats.damage[source.id]=(this.s.stats.damage[source.id]||0)+real+shieldDamage;
  this.onEffect({type:'hit',x:e.x,y:e.y,value:Math.round(real+shieldDamage),damageType:type,from:[bu.x,bu.y]});
  if(e.hp<=0){this.s.battle.kills++;this.s.stats.kills++;if(e.bounty)this.s.battle.bountyKills++;if(o.killDP)this.s.battle.dp=Math.min(99,this.s.battle.dp+o.killDP);this.trait(source,'kill');this.onEffect({type:'death',x:e.x,y:e.y});}
 }
 damageUnit(bu,enemy,amount,arts=false){if(bu.hp<=0||!bu.deployed||bu.invulnerable||(permissions(bu).sleeping&&!enemy.canDamageSleeping))return;const source=this.s.units.find(u=>u.uid===bu.uid),o=this.content.OP[bu.id],skill=this.skill(source),active=bu.active>0;const dodge=1-(1-(o.dodge||0))*(1-(active?(skill.dodge||0):0));if(arts!=='true'&&this.random()<dodge)return;
  const stats=this.attributes(source,bu),type=typeof arts==='string'?arts:arts?'arts':'physical';
  const applied=applyDamage(bu,damage({amount,type,defense:stats.def,resistance:stats.res,elementResistance:bu.stats.elementResistance||0,penetration:type==='arts'?(enemy.artsPenetration||0):(enemy.physicalPenetration||0),penetrationRatio:type==='arts'?(enemy.artsPenetrationRatio||0):(enemy.physicalPenetrationRatio||0),reduction:bu.damageReduction||0}),{immortal:active&&skill.immortal,type});
  if(applied.total>0){bu.lastDamagedAt=this.s.battle.time;wakeOnHit(bu);}if(enemy.spOnHit!==false)gainSP(bu,skill,'defensive',1);
  if(bu.hp<=0){bu.hp=0;bu.down=bu.stats.redeploy;bu.active=0;bu.sp=0;bu.spLock=0;bu.deployed=false;cancelAttack(bu);this.trait(source,'death');for(const e of this.s.battle.enemies)if(e.block===bu.uid)e.block=null;this.onEffect({type:'down',x:bu.x,y:bu.y});this.log(o.name+'被击倒，等待自动再部署');}
  return applied;
 }
 releaseAttack(actor,payload){const b=this.s.battle,healing=payload.type==='healing',pool=payload.team==='enemy'||healing?b.units:b.enemies;
  for(const uid of payload.targets){const target=pool.find(t=>t.uid===uid&&t.hp>0&&(pool!==b.units||t.deployed));if(!target)continue;
   const packet={...payload,targets:undefined,target:uid,x:actor.x,y:actor.y,origin:[actor.x,actor.y]};
   if(payload.projectileSpeed>0)b.projectiles.push(packet);else this.impactAttack(packet,target);
  }
  if(payload.team==='operator'){const source=this.s.units.find(u=>u.uid===actor.uid);gainSP(actor,this.skill(source),'attack',payload.spGain??1);}
 }
 impactAttack(packet,target){const b=this.s.battle;if(packet.team==='enemy'){this.damageUnit(target,packet,packet.amount,packet.type);this.onEffect({type:'enemyHit',x:target.x,y:target.y,from:packet.origin});return;}
  const owner=b.units.find(u=>u.uid===packet.owner),source=this.s.units.find(u=>u.uid===packet.owner);if(!owner||!source)return;
  if(packet.type==='healing'){this.heal(owner,target,packet.amount);if(packet.armor)target.armorBuff=3;if(packet.res)target.resBuff=3;return;}
  const victims=packet.aoe?b.enemies.filter(e=>e.hp>0&&Math.hypot(e.x-target.x,e.y-target.y)<=packet.aoe&&(packet.antiAir||!e.flying)):[target];
  for(const e of victims){for(let i=0;i<packet.hits&&e.hp>0;i++)this.hit(owner,source,e,packet.amount,packet.type);if(packet.status)applyStatus(e,packet.status.kind,packet.status.duration,{source:owner.uid});if(packet.slow){e.slow=Math.min(e.slow,packet.slow);e.slowUntil=b.time+1.5;}}
 }
 advanceProjectiles(dt){const b=this.s.battle;const flying=b.projectiles;b.projectiles=[];for(const packet of flying){const pool=packet.team==='enemy'||packet.type==='healing'?b.units:b.enemies,target=pool.find(u=>u.uid===packet.target&&u.hp>0&&(pool!==b.units||u.deployed));if(!target)continue;
  const dx=target.x-packet.x,dy=target.y-packet.y,d=Math.hypot(dx,dy),step=packet.projectileSpeed*dt;if(d<=step)this.impactAttack(packet,target);else{packet.x+=dx/d*step;packet.y+=dy/d*step;b.projectiles.push(packet);}
 }}
 update(dt){if(!Number.isFinite(dt)||dt<0)throw new Error('dt must be a finite nonnegative number');if(this.s.phase!=='battle'||!this.s.battle)return;const b=this.s.battle;b.tickRemainder=(b.tickRemainder||0)+dt;while(b.tickRemainder+1e-10>=1/FPS&&this.s.phase==='battle'){b.tickRemainder=Math.max(0,b.tickRemainder-1/FPS);if(b.tickRemainder<1e-10)b.tickRemainder=0;this.step(1/FPS);}}

 step(dt){
  if(this.s.phase!=='battle'||!this.s.battle)return;const b=this.s.battle;for(const actor of [...b.units,...b.enemies])tickStatuses(actor,dt);b.time+=dt;if(b.benchmark)b.benchmark.elapsedFrames++;this.s.stats.time+=dt;b.dp=Math.min(99,b.dp+dt);b.escalation=1+Math.max(0,b.time-b.limit)*.025;
  while(b.queue.length&&b.queue[0].at<=b.time)this.spawnEnemy(b.queue.shift());
  for(const u of b.units){u.armorBuff=Math.max(0,u.armorBuff-dt);u.resBuff=Math.max(0,u.resBuff-dt);if(u.hp===0){u.down=Math.max(0,u.down-dt);if(u.down===0&&b.dp>=u.stats.dp){b.dp-=u.stats.dp;u.hp=u.maxHp;u.deployed=true;u.sp=Math.min(spCapacity(this.skill(u)),u.stats.initialSP+(this.skill(u).initialSP||0));u.spLock=0;cancelAttack(u);u.deployAt=b.time;u.cd=.2;this.onEffect({type:'redeploy',x:u.x,y:u.y});}}else if(!u.deployed&&b.time>=u.deployAt){u.deployed=true;this.onEffect({type:'redeploy',x:u.x,y:u.y});}}
  const alive=b.units.filter(u=>u.deployed&&u.hp>0);for(const e of b.enemies)if(e.block!==null&&(!permissions(e).beBlocked||!alive.some(u=>u.uid===e.block&&permissions(u).block)))e.block=null;
  for(const e of b.enemies){e.debuff=0;e.vulnerable=1;e.stun=Math.max(0,e.stun-dt);if(e.slowUntil<b.time)e.slow=1;}
  for(const u of alive){const source=this.s.units.find(s=>s.uid===u.uid),skill=this.skill(source);if(u.active>0&&['debuff','sanctuary'].includes(skill.type)){
    for(const e of b.enemies)if(e.hp>0&&Math.hypot(e.x-u.x,e.y-u.y)<(skill.type==='sanctuary'?4:3.4)){if(skill.type==='debuff')e.debuff=skill.power;else{e.vulnerable=skill.power;e.slowUntil=b.time+.15;e.slow=.25;}}
    if(skill.type==='sanctuary')for(const a of alive)if(Math.hypot(a.x-u.x,a.y-u.y)<4)this.heal(u,a,u.stats.atk*.12*dt);
  }}
  for(const u of alive){
   const source=this.s.units.find(s=>s.uid===u.uid),o=this.content.OP[u.id],skill=this.skill(source);if(!source)continue;
   const active=u.active>0;u.active=Math.max(0,u.active-dt);u.spLock=Math.max(0,(u.spLock||0)-dt);
   u.stats=this.attributes(source,u);if(u.maxHp!==u.stats.hp){u.hp=u.hp/u.maxHp*u.stats.hp;u.maxHp=u.stats.hp;}
   if(!active)gainSP(u,skill,'auto',dt*u.stats.sp);
   let regen=u.stats.regen+(active?(skill.regen||0):0)+(active&&skill.type==='defense'?.01:0);if(regen&&u.hp<u.maxHp)recoverHP(u,u.maxHp*regen*dt);
   const allowed=permissions(u);if(!allowed.attack)cancelAttack(u);if(!allowed.attack&&!allowed.skill)continue;if(u.stun>0){u.stun=Math.max(0,u.stun-dt);cancelAttack(u);continue;}
   const released=advanceAttack(u);if(released)this.releaseAttack(u,released);
   const rangeExtra=active?(skill.range||(['heal','sanctuary'].includes(skill.type)?1:0)):0;
    let targets=selectEnemies(u,b.enemies,{cells:this.rangeCells(source,rangeExtra),paths:this.map.paths,antiAir:o.placement!=='melee'||o.antiAir,priority:o.targetPriority,canTargetSleeping:!!o.canTargetSleeping});
    let healTargets=selectAllies(alive,this.rangeCells(source,rangeExtra));
   let shouldSkill=o.cls==='medic'?healTargets.length>0:targets.length>0;
   if(skill.type==='dp'||skill.dp)shouldSkill=true;if(skill.type==='defense')shouldSkill=u.hp<u.maxHp*.95||!!targets.length;if(['selfheal','groupheal'].includes(skill.type))shouldSkill=alive.some(a=>a.hp<a.maxHp*.8&&Math.hypot(a.x-u.x,a.y-u.y)<=2.5);
   const autoPolicy=skill.autoPolicy||o.autoSkillPolicy;const policyReady=autoPolicy?shouldAutoSkill({policy:autoPolicy,ready:u.sp>=skill.sp,deployed:u.deployed,now:b.time,lastOperation:u.lastSkillOperation||0,initialDeployment:u.deployAt,hasTarget:shouldSkill,hasEnemyInSkillRange:b.enemies.some(e=>e.hp>0&&this.inRange(source,e)),hasEnemyInInitialRange:targets.length>0,hasAnyTarget:b.enemies.some(e=>e.hp>0),wasDamaged:b.time-(u.lastDamagedAt??-999)<=dt+1e-8,isToggle:!!skill.toggle,toggleUsed:!!u.toggleUsed}):skill.activation==='auto'&&u.sp>=skill.sp&&shouldSkill;
   if(permissions(u).skill&&!active&&policyReady)this.triggerSkill(u,source,targets);
    if(!allowed.attack||u.action||u.attackCooldown>0)continue;
    const isActive=u.active>0;u.stats=this.attributes(source,u);let power=u.stats.atk*(isActive?(skill.attackScale||1):1);
    if(isActive&&skill.type==='sanctuary')continue;
    const cells=this.rangeCells(source,this.rangeExtra(source));
    targets=selectEnemies(u,b.enemies,{cells,paths:this.map.paths,antiAir:o.placement!=='melee'||o.antiAir,priority:o.targetPriority,canTargetSleeping:!!o.canTargetSleeping});healTargets=selectAllies(alive,cells);
    const chosen=o.cls==='medic'?healTargets.slice(0,o.multi||1):targets.slice(0,o.aoe?1:isActive&&skill.all?999:isActive&&skill.multi?skill.multi:o.multi||1);
    const enhanced=chosen.length&&skill.activation==='nextAttack'&&spendSP(u,skill);
    if(enhanced){power=u.stats.atk*skill.power;u.skillCount++;u.spLock=attackTiming(o.interval,u.stats.speed*100,o.attackWindup).windupFrames/FPS+1/FPS;this.trait(source,'skill');this.onEffect({type:'skill',x:u.x,y:u.y,text:skill.name});}
    if(chosen.length)startAttack(u,{team:'operator',owner:u.uid,targets:chosen.map(t=>t.uid),amount:power,type:o.cls==='medic'?'healing':isActive&&skill.trueDamage?'true':isActive&&skill.arts?'arts':o.damage,hits:isActive||enhanced?(skill.hits||1):1,aoe:o.aoe||0,antiAir:o.placement!=='melee'||!!o.antiAir,slow:isActive?(skill.slow||o.slow):o.slow,armor:isActive&&skill.armor,res:isActive&&skill.res,spGain:enhanced?0:o.attackSPPerAction||1,projectileSpeed:o.projectileSpeed},attackTiming(o.interval,u.stats.speed*100,o.attackWindup));
   }

  if(b.drone){b.drone.time-=dt;const owner=b.units.find(u=>u.uid===b.drone.owner);if(owner)for(const u of alive)if(Math.hypot(u.x-b.drone.x,u.y-b.drone.y)<=1.6)this.heal(owner,u,b.drone.power*dt);if(b.drone.time<=0)b.drone=null;}
  for(const e of b.enemies){
   if(e.hp<=0||e.trainingDummy)continue;const path=this.map.paths[e.path];e.cd-=dt;
   if(e.boss){e.bossClock+=dt;if(e.bossClock>=18){e.bossClock=0;e.shield=e.maxShield;for(const u of alive)if(e.type==='core'||Math.hypot(u.x-e.x,u.y-e.y)<=2.4)this.damageUnit(u,e,e.atk*1.3,e.type==='core');this.onEffect({type:'boss',x:e.x,y:e.y});if(e.type==='mudrock'&&b.time<110){b.total++;b.queue.push({type:'golem',lane:Math.floor(this.random()*2),at:b.time+1,bounty:false});}}}
   if(e.stun>0||!permissions(e).attack)cancelAttack(e);const released=advanceAttack(e);if(released)this.releaseAttack(e,released);
   let blocked=e.block?alive.find(u=>u.uid===e.block&&u.hp>0&&permissions(u).block):null;if(!blocked)e.block=null;
   if(!e.flying&&!e.unblockable&&permissions(e).beBlocked&&!blocked){blocked=alive.find(u=>u.hp>0&&permissions(u).block&&this.tile(u.x,u.y)==='ground'&&Math.hypot(u.x-e.x,u.y-e.y)<.7071&&b.enemies.filter(v=>v.hp>0&&v.block===u.uid).length<u.stats.block);if(blocked){e.block=blocked.uid;if(this.has('wall')&&!b.wallUsed){blocked.shield=blocked.maxHp*1.5;b.wallUsed=true;}}}
    if(e.stun>0)continue;const target=selectDefender(e,alive);
    if(permissions(e).attack&&target&&!e.action&&!(e.attackCooldown>0))startAttack(e,{team:'enemy',owner:e.uid,physicalPenetration:e.physicalPenetration,physicalPenetrationRatio:e.physicalPenetrationRatio,artsPenetration:e.artsPenetration,artsPenetrationRatio:e.artsPenetrationRatio,targets:[target.uid],amount:e.atk*b.escalation,type:e.arts?'arts':'physical',projectileSpeed:e.projectileSpeed??(e.ranged?5:0)},attackTiming(e.interval,(100+statusAttributeChanges(e).attackSpeed)*Math.sqrt(b.escalation),e.attackWindup));
   if(permissions(e).move&&!blocked&&!e.action&&!(target&&e.attackCooldown>0)){let step=e.speed*e.slow*dt*(1+Math.max(0,b.time-b.limit)*.01);while(step>0&&e.segment<path.length-1){const next=path[e.segment+1],dx=next[0]-e.x,dy=next[1]-e.y,d=Math.hypot(dx,dy);if(d<=step){e.x=next[0];e.y=next[1];step-=d;e.segment++;}else{e.x+=dx/d*step;e.y+=dy/d*step;step=0;}}
    if(e.segment>=path.length-1){this.s.hp=Math.max(0,this.s.hp-e.leak);b.leaks+=e.leak;this.s.stats.leaks+=e.leak;e.hp=0;e.escaped=true;this.onEffect({type:'leak',x:e.x,y:e.y});}
   }
  }
  this.advanceProjectiles(dt);
  b.enemies=b.enemies.filter(e=>e.hp>0);
  if(b.benchmark){if(b.benchmark.elapsedFrames>=b.benchmark.duration*FPS){b.time=b.benchmark.duration;this.endBenchmark('timeout');}return;}
  if(this.s.hp<=0){this.finish(false);return;}
  if(this.s.round>=16&&b.time>b.limit){b.pulse+=dt;while(b.pulse>=1){b.pulse--;this.s.hp--;b.leaks++;this.s.stats.leaks++;}if(this.s.hp<=0){this.s.hp=0;this.finish(false);return;}}
  if(!b.queue.length&&!b.enemies.length){this.endRound();return;}
  if(b.time>300){for(const e of b.enemies){this.s.hp=Math.max(0,this.s.hp-e.leak);b.leaks+=e.leak;this.s.stats.leaks+=e.leak;}b.enemies=[];b.queue=[];if(this.s.hp<=0)this.finish(false);else this.endRound();}
 }
 endBenchmark(reason='manual'){if(this.s.phase!=='battle'||!this.s.battle?.benchmark)return false;const b=this.s.battle,target=b.enemies.find(e=>e.trainingDummy);if(!target)return false;this.s.benchmarkResult=dummySummary(target,b.benchmark.elapsedFrames/FPS,reason);b.projectiles=[];this.log('木桩测试结束 · 总伤害 '+Math.round(this.s.benchmarkResult.totalDamage).toLocaleString());this.finish(true);return true;}
 endRound(){const b=this.s.battle;this.s.stats.rounds=this.s.round;this.s.lastResult={round:this.s.round,kills:b.kills,leaks:b.leaks,time:b.time,units:b.units.map(u=>({id:u.id,damage:u.damage,healing:u.healing}))};if(this.has('bounty')&&b.bountyKills>=2){this.s.bonusFunds+=3;this.log('悬赏完成，下回合额外获得 3 资金');}this.log(`第 ${this.s.round} 轮${b.leaks?'作战结束':'完美防卫'} · 击倒 ${b.kills} 名敌人`);
  if(this.s.round>=16){if(this.s.round===16&&this.s.difficulty!=='standard'&&this.s.stats.leaks===0){this.s.hidden=true;this.s.phase='intermission';this.log('无损防卫达成，隐秘核心已显现');}else{this.finish(true);return;}}else this.s.phase='intermission';this.changed();}
 nextRound(){if(this.s.phase!=='intermission')return false;const prev=this.s.round;this.s.round++;this.enterPrep();if([4,8,12].includes(prev)){let pool=this.content.DECISIONS.filter(d=>this.has(d.id)<2),offers=[];while(offers.length<3&&pool.length){const d=this.pick(pool);offers.push(d.id);pool=pool.filter(x=>x.id!==d.id);}this.s.decisionOffers=offers;}this.changed();return true;}
 chooseDecision(id){if(!this.s.decisionOffers?.includes(id))return false;this.s.decisionOffers=null;this.s.decisions.push(id);if(id==='funding')this.s.money+=2;if(id==='expand'){this.s.cap+=2;this.gainEquipment(this.pick(this.content.EQUIPMENT.filter(e=>e.tier<=this.s.level)).id);}if(id==='medical')this.s.hp=Math.min(this.s.maxHp,this.s.hp+8);if(id==='training')this.gainSpell('elite');if(id==='union')for(const a of Object.values(this.allies()))if(a.active)this.addStacks(a.id,15);if(id==='reinforce')for(let i=0;i<2;i++)this.gainOp(this.pick(this.content.OPERATORS.filter(o=>o.tier===Math.min(6,this.s.level+1))).id);this.log(`采纳策略：${this.content.DECISIONS.find(d=>d.id===id).name}`);this.changed();return true;}
 finish(won){this.s.phase='finished';this.s.won=won;if(won)this.s.stats.rounds=this.s.round;this.log(this.s.benchmarkResult?'木桩测试已结算':won?'模拟成功，卫戍协议已完成':'防卫失败，模拟中止');this.changed();}
 serialize(){return JSON.stringify(this.s);}
 static restore(raw,content=LEGACY_CONTENT){try{const s=JSON.parse(raw);if((s.contentId&&s.contentId!==content.id)||(s.contentVersion&&s.contentVersion!==content.version))return null;if(s.version!==content.VERSION||!['briefing','prep','battle','intermission','finished'].includes(s.phase)||!Number.isInteger(s.round)||s.round<1||s.round>17||!content.MAPS[s.map]||!content.DIFFICULTIES[s.difficulty]||!content.STRATEGIES.some(x=>x.id===s.strategy)||!Array.isArray(s.units)||s.units.some(u=>!content.OP[u.id])||!Array.isArray(s.items)||s.items.some(e=>!content.EQ[e.id]&&!content.SP[e.id]))return null;const g=new Game(1,content);s.contentId??=content.id;s.contentVersion??=content.version;g.s=s;if(s.battle){s.battle.rulesVersion=2;s.battle.projectiles??=[];s.battle.tickRemainder??=0;for(const u of [...s.battle.units,...s.battle.enemies]){u.action??=null;u.attackCooldown??=Math.max(0,Math.round((u.cd||0)*FPS));u.spLock??=0;}}return g;}catch{return null;}}
}
