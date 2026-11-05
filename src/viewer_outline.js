(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_core.js'));else root.ViewerOutline=factory(root.ViewerCore)})(globalThis,function(C){
  'use strict';
  const excerpt=(value,length)=>{const chars=Array.from(String(value||'').replace(/\s+/g,' ').trim());return chars.slice(0,length).join('')+(chars.length>length?'…':'')};
  function turns(record,ids,plain){
    const nodes=C.nodeMap(record.raw),rows=[],hasUser=ids.some(id=>nodes[id]?.message?.author?.role==='user');
    for(const id of ids){
      const message=nodes[id]?.message;if(!C.object(message))continue;const info=C.classification(message);
      const value=plain(message)||C.blocks(message).map(b=>b.name||b.id||b.text||'').join(' ');
      if(!hasUser||info.role==='user'||!rows.length){rows.push({node:id,nodes:[id],question:excerpt(value,120)||'…',answer:'',role:info.role})}
      else{const row=rows.at(-1);row.nodes.push(id);if(!row.answer&&info.role==='assistant'&&!info.thought&&!info.tool)row.answer=excerpt(value,320)}
    }
    return rows;
  }
  function create(env){
    const {document:doc,rail,marks,preview,scroller,region,content,onJump}=env,view=env.view||globalThis;
    let rows=[],enabled=true,active=-1,positions=null,scheduled=false,previewTimer,dragPointer=null,lastDragNode=null,suppressClick=false,clickTimer;
    const buttons=[],nodeToTurn=new Map();
    function hide(){clearTimeout(previewTimer);preview.hidden=true;for(const button of buttons)button.removeAttribute?.('aria-describedby')}
    function show(index){
      clearTimeout(previewTimer);const row=rows[index];if(!row||rail.hidden)return;
      const heading=doc.createElement('strong');heading.textContent=row.question;const answer=doc.createElement('p');answer.textContent=row.answer||'…';const count=doc.createElement('small');count.textContent=(index+1)+' / '+rows.length;
      preview.replaceChildren(heading,answer,count);preview.hidden=false;
      for(const button of buttons)button.removeAttribute?.('aria-describedby');buttons[index]?.setAttribute('aria-describedby','turn-preview');
      if(preview.style&&region.getBoundingClientRect&&buttons[index]?.getBoundingClientRect){const box=region.getBoundingClientRect(),mark=buttons[index].getBoundingClientRect();preview.style.top=Math.max(8,Math.min((mark.top-box.top)-35,Math.max(8,box.height-(preview.offsetHeight||160)-8)))+'px'}
    }
    function setActive(index){
      if(index===active)return;active=index;
      buttons.forEach((button,i)=>{button.tabIndex=i===index?0:-1;button.classList.toggle('active',i===index);if(i===index)button.setAttribute('aria-current','location');else button.removeAttribute?.('aria-current')});
      buttons[index]?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});
    }
    function update(){
      if(rail.hidden||!rows.length)return;
      if(dragPointer!==null&&lastDragNode!==null){const i=rows.findIndex(row=>row.node===lastDragNode);if(i>=0)setActive(i);return}
      if(!scroller.getBoundingClientRect){setActive(0);return}
      if(!positions){const top=scroller.getBoundingClientRect().top;positions=[...content.querySelectorAll('article[data-node]')].map(article=>({node:article.dataset.node,offset:article.getBoundingClientRect().top-top+(scroller.scrollTop||0)})).filter(item=>nodeToTurn.has(item.node)).sort((a,b)=>a.offset-b.offset)}
      if(!positions.length){setActive(0);return}
      if(scroller.clientHeight&&scroller.scrollHeight&&(scroller.scrollTop||0)+scroller.clientHeight>=scroller.scrollHeight-2){setActive(nodeToTurn.get(positions.at(-1).node)??0);return}
      const line=(scroller.scrollTop||0)+Math.min(100,(scroller.clientHeight||500)*.18);let lo=0,hi=positions.length-1;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(positions[mid].offset<=line)lo=mid;else hi=mid-1}
      setActive(nodeToTurn.get(positions[lo].node)??0);
    }
    function schedule(){if(scheduled)return;scheduled=true;const run=()=>{scheduled=false;update()};if(view.requestAnimationFrame)view.requestAnimationFrame(run);else setTimeout(run,0)}
    function refresh(){positions=null;schedule()}
    function visibility(){rail.hidden=!enabled||rows.length<2;region.classList.toggle('has-outline',!rail.hidden);if(rail.hidden)hide();refresh()}
    function set(record,next){
      rows=next;active=-1;positions=null;hide();marks.replaceChildren();buttons.length=0;nodeToTurn.clear();rail.style?.setProperty('--turn-count',rows.length);
      rows.forEach((row,index)=>{
        for(const id of row.nodes)nodeToTurn.set(id,index);
        const button=doc.createElement('button');button.type='button';button.tabIndex=index===0?0:-1;button.className='turn-mark';button.dataset.node=row.node;button.setAttribute('aria-label',(index+1)+': '+row.question);button.setAttribute('aria-controls','msgs');
        const bar=doc.createElement('span');button.append(bar);
        button.addEventListener('click',event=>{if(suppressClick&&event.detail!==0)return;hide();Promise.resolve(onJump(row,record?.key||'')).catch(error=>env.onError?.(error))});
        button.addEventListener('pointerenter',()=>show(index));
        button.addEventListener('focus',()=>show(index));button.addEventListener('blur',hide);
        button.addEventListener('keydown',event=>{let target;if(event.key==='ArrowDown')target=Math.min(buttons.length-1,index+1);else if(event.key==='ArrowUp')target=Math.max(0,index-1);else if(event.key==='Home')target=0;else if(event.key==='End')target=buttons.length-1;else if(event.key==='Escape'){hide();return}else return;event.preventDefault();buttons[target]?.focus?.()});
        buttons.push(button);marks.append(button);
      });visibility();
    }
    let currentRecord='';const originalSet=set;
    function hit(event,allowTarget=false){
      const inside=box=>event.clientY>=box.top&&event.clientY<box.bottom&&(!Number.isFinite(event.clientX)||event.clientX>=box.left&&event.clientX<=box.right);
      const box=rail.getBoundingClientRect?.();if(box&&Number.isFinite(box.bottom)&&!inside(box))return -1;
      // Use actual button rectangles: padding, centering and a scrolled rail do not
      // change the mapping. Never interpolate a position inside a conversation.
      const index=buttons.findIndex(button=>{const rect=button.getBoundingClientRect?.();return rect&&inside(rect)});
      if(index>=0||!allowTarget)return index;
      return buttons.indexOf(event.target.closest?.('.turn-mark'));
    }
    function visit(index){
      const row=rows[index];if(!row||row.node===lastDragNode)return;
      lastDragNode=row.node;setActive(index);show(index);
      try{Promise.resolve(onJump(row,currentRecord)).catch(error=>env.onError?.(error))}catch(error){env.onError?.(error)}
    }
    rail.addEventListener('pointerdown',event=>{
      if(event.button!==0||rail.hidden||dragPointer!==null)return;const index=hit(event,true);if(index<0)return;
      event.preventDefault();clearTimeout(clickTimer);dragPointer=event.pointerId;lastDragNode=null;suppressClick=true;
      rail.setPointerCapture?.(event.pointerId);visit(index);
    });
    rail.addEventListener('pointermove',event=>{if(dragPointer===null||event.pointerId!==dragPointer)return;event.preventDefault();visit(hit(event))});
    function stop(event){
      if(dragPointer===null||event?.pointerId!==undefined&&event.pointerId!==dragPointer)return;
      const pointer=dragPointer;dragPointer=null;lastDragNode=null;
      if(rail.hasPointerCapture?.(pointer))rail.releasePointerCapture?.(pointer);
      clearTimeout(clickTimer);clickTimer=setTimeout(()=>suppressClick=false,0);
    }
    for(const name of ['pointerup','pointercancel','lostpointercapture'])rail.addEventListener(name,stop);
    scroller.addEventListener('scroll',()=>{if(dragPointer!==null){const i=rows.findIndex(row=>row.node===lastDragNode);if(i>=0)show(i)}else hide();schedule()},{passive:true});scroller.addEventListener('load',refresh,true);scroller.addEventListener('toggle',refresh,true);
    view.addEventListener?.('resize',refresh);view.addEventListener?.('blur',()=>{stop();hide()});rail.addEventListener('mouseleave',hide);
    if(view.ResizeObserver){const observer=new view.ResizeObserver(refresh);observer.observe(content)}
    doc.fonts?.ready.then(refresh);
    return {set(record,next){if(!record||currentRecord!==record.key)stop();currentRecord=record?.key||'';originalSet(record,next)},refresh,update,show,hide,setActive,setEnabled(value){enabled=Boolean(value);if(!enabled)stop();visibility()},getRows:()=>rows,getActive:()=>active};
  }
  return {turns,create,excerpt};
});
