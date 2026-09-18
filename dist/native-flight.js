// 自由飞行移动原语（连续坐标，不做格子吸附、不走路网）。
// 用于「炎佑」与荒芜拉普兰德的「特殊形态浮游单元」——两者飞行逻辑各自实现，只共用这里的向量推进。
// 速度单位为「格/秒」：1 表示每秒移动 1 个地块。

const FULL_TURN=Math.PI*2;
export const FLIGHT_MODES={SCATTER:'scatter',CHASE:'chase',ORBIT:'orbit'};

export const FLIGHT_PRESETS={
 // 荒芜拉普兰德「终幕·浩劫」浮游单元：散开 → 追击 → 抵达
 litter:{scatterSeconds:1.3,scatter:{speed:0.1,accel:1.9,maxSpeed:2.0},chase:{speed:2.0,accel:1.0,maxSpeed:4.0,turnPerFrame:1/6},arrive:.15},
 // 炎佑：恒速巡航，进入攻击范围即停
 guardian:{chase:{speed:1,accel:6,maxSpeed:1,turnPerFrame:1/4},arrive:.05},
};

export function wrapAngle(value){
 let angle=Number(value)||0;
 while(angle>Math.PI)angle-=FULL_TURN;
 while(angle<-Math.PI)angle+=FULL_TURN;
 return angle;
}
export function flightPointOf(actor){return {x:Number(actor?.x)||0,y:Number(actor?.y)||0};}
export function ensureFlight(actor){
 if(!actor.travel)actor.travel={vx:0,vy:0,speed:0,phase:FLIGHT_MODES.CHASE,phaseLeft:0,heading:0};
 if(actor.x==null)actor.x=0;
 if(actor.y==null)actor.y=0;
 return actor.travel;
}
export function setFlightVelocity(actor,speed,heading){
 const travel=ensureFlight(actor);
 travel.heading=heading;travel.speed=Math.max(0,Number(speed)||0);
 travel.vx=Math.cos(heading)*travel.speed;travel.vy=Math.sin(heading)*travel.speed;
 return travel;
}
export function faceTarget(actor,target,{turnPerFrame=0,dt=0}={}){
 const travel=ensureFlight(actor),from=flightPointOf(actor),to=flightPointOf(target);
 const heading=Math.atan2(to.y-from.y,to.x-from.x);
 if(turnPerFrame>0){
  // 转向速度按帧给定：先按 30Hz 帧换算成角度/秒，再按本次 dt 应用
  const maxTurn=turnPerFrame*30*dt;
  travel.heading=travel.heading+Math.max(-maxTurn,Math.min(maxTurn,wrapAngle(heading-travel.heading)));
 }else travel.heading=heading;
 return travel.heading;
}
export function distanceBetween(a,b){const p=flightPointOf(a),q=flightPointOf(b);return Math.hypot(q.x-p.x,q.y-p.y);}
function clampToBounds(actor,bounds){
 if(!bounds)return;
 const left=bounds.left??0,right=bounds.right??left,top=bounds.top??0,bottom=bounds.bottom??top;
 actor.x=Math.max(left,Math.min(right,actor.x));
 actor.y=Math.max(top,Math.min(bottom,actor.y));
}
// 沿指定/当前朝向推进。到达目的地附近返回 true（不吸附到该点，位置保持连续）。
// 返回 {arrived,remaining} 便于调用方判断是否进入下一阶段。
export function stepFlight(actor,dt,{accel=0,maxSpeed=Infinity,destination=null,bounds=null,arrive=.15}={}){
 const travel=ensureFlight(actor);
 const step=Math.max(0,Number(dt)||0);
 if(!step)return {arrived:false,remaining:destination?distanceBetween(actor,destination):Infinity};
 let remaining=Infinity;
 if(destination){
  remaining=distanceBetween(actor,destination);
  if(remaining>1e-9)travel.heading=Math.atan2(destination.y-actor.y,destination.x-actor.x);
 }
 const ceiling=Number.isFinite(Number(maxSpeed))?Number(maxSpeed):travel.speed;
 travel.speed=Math.max(0,Math.min(ceiling,travel.speed+Math.max(0,Number(accel)||0)*step));
 const advance=Math.min(travel.speed*step,Number.isFinite(remaining)?remaining:Infinity);
 actor.x+=Math.cos(travel.heading)*advance;
 actor.y+=Math.sin(travel.heading)*advance;
 travel.vx=Math.cos(travel.heading)*travel.speed;
 travel.vy=Math.sin(travel.heading)*travel.speed;
 clampToBounds(actor,bounds);
 if(!destination)return {arrived:false,remaining:Infinity};
 return {arrived:distanceBetween(actor,destination)<=Math.max(0,Number(arrive)||0),remaining:distanceBetween(actor,destination)};
}
export function orbitStep(actor,center,dt,{radius=.9,lineSpeed=1,direction=-1}={}){
 const travel=ensureFlight(actor);
 const step=Math.max(0,Number(dt)||0);
 if(!step)return;
 let angle=Math.atan2(actor.y-center.y,actor.x-center.x);
 angle+=direction*lineSpeed/Math.max(1e-6,radius)*step;
 actor.x=center.x+Math.cos(angle)*radius;
 actor.y=center.y+Math.sin(angle)*radius;
 travel.heading=angle+(direction>0?Math.PI/2:-Math.PI/2);
 travel.speed=lineSpeed;
 travel.vx=Math.cos(travel.heading)*lineSpeed;
 travel.vy=Math.sin(travel.heading)*lineSpeed;
}
// 以当前朝向为基准，把 count 个方向均匀铺开（始终包含自身朝向）
export function fanHeadings(baseHeading,count,spread=Math.PI*2){
 const headings=[];
 if(count<=1)return [baseHeading];
 const step=spread/count;
 for(let i=0;i<count;i++)headings.push(wrapAngle(baseHeading-step/2+(i+.5)*step));
 return headings;
}
export function randomPointInSquare(center,halfSide,random=Math.random){
 return {x:center.x+(random()*2-1)*halfSide,y:center.y+(random()*2-1)*halfSide};
}
