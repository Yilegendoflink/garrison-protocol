// Shared by the preview and the live battle: querying never advances game state or RNG.
export function nativeWavePlan(data,turn){
 if(!turn)return null;
 if(turn.isBossTurn)return {round:turn.round,benchmark:true,total:0,targets:1,queue:[],level:null,levelId:null};
 const levelId=turn.battles[0]?.levelId.toLowerCase(),level=data.levels[levelId];if(!level)throw Error('缺少关卡模板 '+levelId);
 const queue=[];let offset=0;
 for(const wave of level.waves){offset+=wave.preDelay||0;let finish=offset;for(const fragment of wave.fragments){const start=offset+(fragment.preDelay||0);for(const a of fragment.actions){if(a.actionType!=='SPAWN')continue;const r=level.routes[a.routeIndex];if(!r||r.startPosition.col>10||r.startPosition.row<6||r.startPosition.row>12)continue;for(let i=0;i<a.count;i++){const at=start+(a.preDelay||0)+i*(a.interval||0);queue.push({id:a.key,at,route:a.routeIndex});finish=Math.max(finish,at);}}}offset=finish+(wave.postDelay||0);}
 queue.sort((a,b)=>a.at-b.at);return {round:turn.round,benchmark:false,total:queue.length,targets:queue.length,queue,level,levelId};
}
