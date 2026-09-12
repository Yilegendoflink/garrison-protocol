import {LEGACY_CONTENT} from './content.js';
import {Game} from './engine.js';
const INTEGER=v=>Number.isInteger(v)&&v>=0;
const ACTIONS={
 benchmark:{phase:'prep',method:'startBenchmark',check:a=>!a.length},endBenchmark:{phase:'battle',method:'endBenchmark',check:a=>!a.length},
 preferences:{phase:'briefing',method:'setPreferences',check:(a,p)=>a.length===1&&a[0]&&Object.keys(a[0]).every(k=>['difficulty','map','strategy'].includes(k))&&(!('difficulty'in a[0])||!!p.DIFFICULTIES[a[0].difficulty])&&(!('map'in a[0])||INTEGER(a[0].map)&&!!p.MAPS[a[0].map])&&(!('strategy'in a[0])||p.STRATEGIES.some(s=>s.id===a[0].strategy))},
 begin:{phase:'briefing',method:'start',check:a=>a.length===0},
 buy:{phase:'prep',method:'buy',check:a=>a.length===1&&INTEGER(a[0])},
 refresh:{phase:'prep',method:'refresh',check:a=>!a.length},upgrade:{phase:'prep',method:'upgrade',check:a=>!a.length},lock:{phase:'prep',method:'lock',check:a=>!a.length},
 deploy:{phase:'prep',method:'deploy',check:a=>(a.length===3||a.length===4)&&a.every(INTEGER)&&(a.length===3||a[3]<4)},turn:{phase:'prep',method:'turn',check:a=>a.length===2&&INTEGER(a[0])&&INTEGER(a[1])&&a[1]<4},
 withdraw:{phase:'prep',method:'withdraw',check:a=>a.length===1&&INTEGER(a[0])},sell:{phase:'prep',method:'sell',check:a=>a.length===1&&INTEGER(a[0])},
 equip:{phase:'prep',method:'equip',check:a=>a.length>=2&&a.length<=3&&a.every(INTEGER)},spell:{phase:'prep',method:'useSpell',check:a=>a.length>=1&&a.length<=2&&a.every(INTEGER)},
 promotion:{phase:'prep',method:'takePromotion',check:a=>a.length===1&&INTEGER(a[0])},decision:{phase:'prep',method:'chooseDecision',check:a=>a.length===1&&typeof a[0]==='string'},
 start:{phase:'prep',method:'startBattle',check:a=>!a.length},next:{phase:'intermission',method:'nextRound',check:a=>!a.length},
 skillPreference:{phase:'briefing',check:(a,p)=>a.length===2&&!!p.OP[a[0]]&&INTEGER(a[1])&&!!p.OP[a[0]].skills[a[1]]}
};
export class GameSession {
 constructor(game=new Game(),content={id:game.content.id,version:game.content.version}){this.game=game;this.content=JSON.parse(JSON.stringify(content));this.frame=0;this.revision=0;this.sequence=0;this.commands=[];this.initialState=game.serialize();this.remainder=0;this.receipts=new Map();}
 inspect(type,args=[],positionOnly=false){
  const rule=ACTIONS[type];if(!rule)return {ok:false,code:'UNKNOWN_COMMAND',message:'不支持的操作。'};
  if(!Array.isArray(args)||!rule.check(args,this.game.content))return {ok:false,code:'INVALID_ARGUMENT',message:'操作参数无效。'};
  if(this.game.s.phase!==rule.phase)return {ok:false,code:'WRONG_PHASE',message:'当前阶段不能执行此操作。'};
  if(type==='deploy'&&!positionOnly&&args.length===3&&this.game.s.units.find(u=>u.uid===args[0])?.x===null)return {ok:false,code:'DIRECTION_REQUIRED',message:'请先选择部署朝向。'};
  const copy=Game.restore(this.game.serialize(),this.game.content);if(!copy)return {ok:false,code:'INVALID_STATE',message:'对局状态无法恢复。'};
  const notices=[],effects=[];copy.onNotice=m=>notices.push(m);copy.onEffect=e=>effects.push(e);
  let result;if(type==='skillPreference'){copy.s.skillPrefs[args[0]]=args[1];result=true;}else result=copy[rule.method](...args);
  if(result!==true)return {ok:false,code:result==='replace'?'REPLACE_REQUIRED':result==='target'?'TARGET_REQUIRED':'RULE_REJECTED',message:notices.at(-1)||(result==='replace'?'请选择要替换的装备。':'当前条件不允许此操作。')};
  return {ok:true,code:'OK',state:copy.s,effects};
 }
 preview(type,args=[]){const r=this.inspect(type,args,true);return {ok:r.ok,code:r.code,message:r.message||null,phase:this.game.s.phase,revision:this.revision};}
 dispatch(command){
  if(!command||command.actor!=='local'||!Number.isInteger(command.seq))return {ok:false,code:'INVALID_ENVELOPE'};
  const signature=JSON.stringify(command);const previous=this.receipts.get(command.seq);if(previous)return previous.signature===signature?previous.receipt:{ok:false,code:'SEQUENCE_CONFLICT'};
  if(command.seq!==this.sequence+1)return {ok:false,code:'OUT_OF_ORDER'};
  if(command.frame!==this.frame||command.revision!==this.revision||command.phase!==this.game.s.phase)return {ok:false,code:'STALE_COMMAND',message:'阶段或对局已变化，请重新操作。'};
  const r=this.inspect(command.type,command.args);this.sequence=command.seq;
  const receipt={ok:r.ok,code:r.code,message:r.message||null,seq:command.seq,frame:this.frame};
  this.receipts.set(command.seq,{signature,receipt});this.commands.push({command:JSON.parse(signature),receipt});
  if(r.ok){this.game.s=r.state;this.revision++;for(const e of r.effects)this.game.onEffect(e);this.game.changed();}else if(r.message)this.game.onNotice(r.message);
  return receipt;
 }
 send(type,...args){return this.dispatch({actor:'local',seq:this.sequence+1,frame:this.frame,revision:this.revision,phase:this.game.s.phase,type,args});}
 advance(dt){if(!Number.isFinite(dt)||dt<0)throw Error('Invalid time delta');this.remainder+=dt;while(this.remainder+1e-10>=1/30){this.remainder=Math.max(0,this.remainder-1/30);if(this.remainder<1e-10)this.remainder=0;if(this.game.s.phase==='battle'){this.game.update(1/30);this.frame++;}}}
 exportReplay(){return {version:1,content:this.content,initialState:this.initialState,commands:this.commands,finalFrame:this.frame,finalState:this.game.serialize()};}
 static replay(record,content,gameContent=LEGACY_CONTENT){if(record.version!==1||JSON.stringify(record.content)!==JSON.stringify(content))throw Error('Replay content version mismatch');const game=Game.restore(record.initialState,gameContent);if(!game)throw Error('Invalid replay initial state');const session=new GameSession(game,content);for(const {command,receipt}of record.commands){if(command.frame<session.frame)throw Error('Invalid replay order');while(session.frame<command.frame){if(game.s.phase!=='battle')throw Error('Cannot advance replay');session.advance(1/30);}const actual=session.dispatch(command);if(actual.code!==receipt.code)throw Error('Replay diverged at '+command.seq);}while(session.frame<record.finalFrame){if(game.s.phase!=='battle')throw Error('Invalid final replay frame');session.advance(1/30);}if(game.serialize()!==record.finalState)throw Error('Replay state mismatch');return session;}
}
export class InteractionState {
 constructor(){this.cancel();}
 select(uid,phase){this.cancel();this.uid=uid;this.phase=phase;this.mode='selected';}
 preview(session,x,y){if(this.uid===null)return {ok:false,code:'NO_SELECTION'};const result=session.preview('deploy',[this.uid,x,y]);this.cell=result.ok?{x,y}:null;this.mode='deploy-preview';this.requiresDirection=session.game.s.units.find(u=>u.uid===this.uid)?.x===null;this.revision=session.revision;this.phase=session.game.s.phase;return result;}
 lockPosition(session,x,y){const result=this.preview(session,x,y);if(!result.ok)return result;const unit=session.game.s.units.find(u=>u.uid===this.uid);this.requiresDirection=unit?.x===null;this.mode=this.requiresDirection?'direction':'position-ready';this.direction=this.requiresDirection?null:unit?.dir??0;return result;}
 setDirection(direction){if(this.mode!=='direction'||!Number.isInteger(direction)||direction<0||direction>3)return false;this.direction=direction;return true;}
 aim(dx,dy,threshold=18){if(this.mode!=='direction')return null;this.direction=Math.hypot(dx,dy)<threshold?null:Math.abs(dx)>Math.abs(dy)?(dx>0?0:2):(dy>0?1:3);return this.direction;}
 commit(session){if(this.requiresDirection&&(this.mode!=='direction'||this.direction===null))return {ok:false,code:'DIRECTION_REQUIRED'};if(!this.cell||this.phase!==session.game.s.phase||this.revision!==session.revision){this.cancel();return {ok:false,code:'STALE_PREVIEW'};}const r=this.requiresDirection?session.send('deploy',this.uid,this.cell.x,this.cell.y,this.direction):session.send('deploy',this.uid,this.cell.x,this.cell.y);if(r.ok)this.cancel();return r;}
 cancel(){this.mode='idle';this.uid=null;this.cell=null;this.phase=null;this.revision=null;this.direction=null;this.requiresDirection=false;}
}
