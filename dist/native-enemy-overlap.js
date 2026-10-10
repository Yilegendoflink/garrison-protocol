// 纯显示布局：输入中的敌人、坐标和战斗状态一律只读。
const close=(a,b,factor)=>Math.abs(a.x-b.x)<Math.min(a.size,b.size)*factor&&Math.abs(a.y-b.y)<Math.min(a.size,b.size)*factor;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function enemyOverlapLayout(entries,bounds,previous=[]){
 const visible=entries.filter(v=>v.enemy.hp>0&&!v.enemy.hidden&&!v.enemy.trainingDummy&&!v.enemy.finalBoss).sort((a,b)=>a.enemy.uid-b.enemy.uid),byUid=new Map(visible.map(v=>[v.enemy.uid,v])),used=new Set(),groups=[];
 // 分离阈值稍大于合并阈值，避免移动到边缘时一帧合并、一帧拆开。
 for(const old of previous){const members=old.entries.map(v=>byUid.get(v.enemy.uid)).filter(Boolean),anchor=members[0];if(!anchor)continue;const retained=members.filter(v=>!used.has(v.enemy.uid)&&close(anchor,v,.9));if(retained.length){groups.push({entries:retained});for(const v of retained)used.add(v.enemy.uid);}}
 // ponytail: 当前波次规模下用锚点约束的二次扫描；出现千人波次后再换空间桶，禁止连通链跨整条路合成一组。
 for(const v of visible){if(used.has(v.enemy.uid))continue;const group=groups.find(g=>close(g.entries[0],v,.7));if(group)group.entries.push(v);else groups.push({entries:[v]});used.add(v.enemy.uid);}
 const positions=new Map(),plates=[];
 for(const group of groups){
  group.entries.sort((a,b)=>a.enemy.uid-b.enemy.uid);group.uid=group.entries[0].enemy.uid;
  const n=group.entries.length;group.x=group.entries.reduce((sum,v)=>sum+v.x,0)/n;group.y=group.entries.reduce((sum,v)=>sum+v.y,0)/n;
  for(const [i,v] of group.entries.entries()){
   const step=Math.min(10,v.size*.2),angle=i*2.399963,radius=n>1?step*(.55+Math.min(i,7)*.12):0;
   positions.set(v.enemy.uid,{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,groupUid:n>1?group.uid:null});
  }
  if(n<2)continue;
  const w=Math.min(132,bounds.w),h=Math.min(n,4)*20+(bounds.coarse?44:20)+8,anchorSize=Math.max(...group.entries.map(v=>v.size));
  const candidates=[{x:group.x-w/2,y:group.y-anchorSize/2-h-8},{x:group.x+anchorSize/2+8,y:group.y-h/2},{x:group.x-anchorSize/2-w-8,y:group.y-h/2}].map(p=>({x:clamp(p.x,bounds.x,bounds.x+bounds.w-w),y:clamp(p.y,bounds.y,bounds.y+bounds.h-h),w,h}));
  group.plate=candidates.find(p=>!plates.some(q=>intersects(p,q)))||candidates[0];plates.push(group.plate);
 }
 return {groups:groups.filter(g=>g.entries.length>1),positions};
}

export function enemyHealthLabel(enemy){return enemy.hitCountHp?`${Math.max(0,Math.ceil(enemy.hp))}次`:`${Math.round(clamp(enemy.hp/Math.max(1,enemy.maxHp),0,1)*100)}%`;}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const healthRatio=e=>clamp(e.hp/Math.max(1,e.maxHp),0,1);
const statusText=e=>[e.block!=null?'被阻挡':'',e.invulnerable?'无敌':'',e.shield>0?'有护盾':'',...(e.statuses||[]).map(s=>({stun:'眩晕',frozen:'冻结',sleep:'睡眠',sluggish:'减速',root:'束缚',levitate:'浮空',cold:'寒冷',invisible:'隐匿',camouflage:'迷彩'}[s.kind]||''))].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,3).join(' · ');

export function createEnemyOverlapHud({asset,name,onChange=()=>{}}){
 let layer=null,panel=null,groups=[],selectedUid=null,openUids=[],nodes=new Map(),nextRefresh=0,battleKey=null;
 const image=e=>{const src=asset(e);return src?`<img src="./${esc(src)}" alt="" draggable="false">`:'<span class="native-overlap-no-art">◆</span>';};
 const enemyName=e=>name(e)||e.name||e.id;
 const aria=e=>`${enemyName(e)}，${e.hitCountHp?'剩余次数':'生命'} ${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`;
 function closePanel(){const uid=groups.find(g=>g.entries.some(v=>v.enemy.uid===selectedUid))?.uid;openUids=[];selectedUid=null;panel.hidden=true;layer.querySelector(`[data-overlap-group="${uid}"]`)?.focus();}
 function interact(event){
  event.stopPropagation();const button=event.target.closest('button');if(!button)return;
  if(button.dataset.overlapGroup){const g=groups.find(g=>g.uid===Number(button.dataset.overlapGroup));if(!g)return;if(g.entries.some(v=>openUids.includes(v.enemy.uid)))closePanel();else{openUids=g.entries.map(v=>v.enemy.uid);selectedUid=openUids.includes(selectedUid)?selectedUid:openUids[0];}}
  else if(button.dataset.overlapEnemy)selectedUid=Number(button.dataset.overlapEnemy);
  else if(button.hasAttribute('data-overlap-close'))closePanel();
  nextRefresh=0;onChange();
 }
 function mount(board){
  if(layer?.parentElement===board)return;
  layer=document.createElement('div');layer.className='native-enemy-overlap-layer';board.append(layer);panel=document.createElement('section');panel.className='native-enemy-overlap-panel';panel.setAttribute('aria-label','重叠敌人详情');panel.hidden=true;layer.append(panel);nodes=new Map();
  layer.addEventListener('click',interact);
  for(const type of ['pointerdown','pointerup'])layer.addEventListener(type,e=>e.stopPropagation());
  layer.addEventListener('keydown',e=>{if(e.key==='Escape'&&openUids.length){e.preventDefault();e.stopPropagation();closePanel();nextRefresh=0;onChange();}});
 }
 return {
  get selectedUid(){return selectedUid;},
  clear(){layer?.remove();layer=panel=null;groups=[];selectedUid=null;openUids=[];nodes=new Map();battleKey=null;},
  update({board,canvas,battle,entries,bounds}){
   if(battle!==battleKey){groups=[];selectedUid=null;openUids=[];battleKey=battle;nextRefresh=0;}
   const layout=enemyOverlapLayout(entries,bounds,groups);groups=layout.groups;mount(board);
   const boardRect=board.getBoundingClientRect(),canvasRect=canvas.getBoundingClientRect(),dx=canvasRect.left-boardRect.left,dy=canvasRect.top-boardRect.top,active=new Set(groups.map(g=>g.uid)),now=performance.now();let refresh=now>=nextRefresh;
   for(const [uid,node] of nodes)if(!active.has(uid)){node.remove();nodes.delete(uid);}
   for(const group of groups){
    let node=nodes.get(group.uid);if(!node){node=document.createElement('div');node.className='native-enemy-overlap-stack';nodes.set(group.uid,node);layer.append(node);}
    const signature=group.entries.slice(0,4).map(v=>v.enemy.uid+':'+asset(v.enemy)).join(',')+':'+group.entries.length;
    if(node.dataset.signature!==signature){refresh=true;node.dataset.signature=signature;node.innerHTML=group.entries.slice(0,4).map(({enemy:e},i)=>`<button type="button" data-overlap-enemy="${e.uid}" class="native-enemy-overlap-row">${image(e)}<span class="native-overlap-index">${i+1}</span><span class="native-overlap-track"><i></i></span><span class="native-overlap-health"></span></button>`).join('')+`<button type="button" data-overlap-group="${group.uid}" class="native-enemy-overlap-count">×${group.entries.length}${group.entries.length>4?` <small>＋${group.entries.length-4}</small>`:''}</button>`;}
    node.style.left=group.plate.x+dx+'px';node.style.top=group.plate.y+dy+'px';node.style.width=group.plate.w+'px';
    node.querySelector('[data-overlap-group]').setAttribute('aria-label',`查看重叠的 ${group.entries.length} 名敌人`);
    node.querySelector('[data-overlap-group]').setAttribute('aria-expanded',String(group.entries.some(v=>openUids.includes(v.enemy.uid))));
    for(const {enemy:e} of group.entries.slice(0,4)){const row=node.querySelector(`[data-overlap-enemy="${e.uid}"]`);row.classList.toggle('is-concealed',!!e.invisible);row.setAttribute('aria-pressed',String(e.uid===selectedUid));if(refresh){row.setAttribute('aria-label',aria(e));row.title=enemyName(e);row.querySelector('i').style.width=healthRatio(e)*100+'%';row.querySelector('.native-overlap-health').textContent=enemyHealthLabel(e);}}
   }
   const live=new Map(entries.filter(v=>v.enemy.hp>0&&!v.enemy.hidden).map(v=>[v.enemy.uid,v.enemy]));
   // 打开详情后跟随活着的成员；分组变动或组长死亡不把名单重置成另一个组。
   openUids=openUids.filter(uid=>live.has(uid));if(!live.has(selectedUid))selectedUid=openUids[0]??null;
   const followed=groups.find(g=>g.entries.some(v=>v.enemy.uid===selectedUid));if(openUids.length&&followed)openUids=followed.entries.map(v=>v.enemy.uid);
   panel.hidden=!openUids.length;
   if(openUids.length){
    const signature=openUids.join(',');if(panel.dataset.signature!==signature){refresh=true;panel.dataset.signature=signature;panel.innerHTML=`<header><b>重叠敌人 <span></span></b><button type="button" data-overlap-close aria-label="关闭重叠敌人详情">关闭</button></header><div class="native-overlap-list">${openUids.map(uid=>{const e=live.get(uid);return `<button type="button" data-overlap-enemy="${uid}" class="native-overlap-detail-row">${image(e)}<span><b>${esc(enemyName(e))}</b><small></small><span class="native-overlap-track"><i></i></span></span><span class="native-overlap-detail-hp"></span></button>`;}).join('')}</div>`;}
    panel.querySelector('header span').textContent=`· ${openUids.length}名`;
    const panelWidth=Math.min(280,Math.max(160,bounds.w*.45),bounds.w-8),panelX=followed&&followed.x<bounds.x+bounds.w/2?bounds.x+bounds.w-panelWidth-4:bounds.x+4;
    const topSpace=(bounds.gridTop??bounds.y)-bounds.y-8,panelHeight=topSpace>=90?Math.min(topSpace,360):bounds.h-8;
    panel.style.left=panelX+dx+'px';panel.style.top=bounds.y+dy+4+'px';panel.style.width=panelWidth+'px';panel.style.maxHeight=Math.max(90,panelHeight)+'px';
    for(const [i,uid] of openUids.entries()){const e=live.get(uid),row=panel.querySelector(`[data-overlap-enemy="${uid}"]`);row.classList.toggle('is-concealed',!!e.invisible);row.setAttribute('aria-pressed',String(uid===selectedUid));if(refresh){row.setAttribute('aria-label',aria(e));row.querySelector('small').textContent=`第${i+1}名${statusText(e)?' · '+statusText(e):''}`;row.querySelector('i').style.width=healthRatio(e)*100+'%';row.querySelector('.native-overlap-detail-hp').textContent=e.hitCountHp?`${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}次`:`${Math.ceil(e.hp).toLocaleString()} / ${Math.ceil(e.maxHp).toLocaleString()}`;}}
   }
   if(refresh)nextRefresh=now+150;
   return layout.positions;
  }
 };
}
