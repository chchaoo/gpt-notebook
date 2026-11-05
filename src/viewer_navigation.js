(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./viewer_search.js'));else root.ViewerNavigation=factory(root.ViewerSearch)})(globalThis,function(Search){
  'use strict';
  function occurrences(value,query,options={}){return Search.ranges(value,query,options)}
  function wrap(index,step,total){return total?((index+step)%total+total)%total:-1}
  function textNodes(root){
    const out=[],walker=root.ownerDocument.createTreeWalker(root,4);
    let node;while((node=walker.nextNode())){
      const ignored=node.parentElement.closest('button,summary,.asset,.reference-block,.katex,.math-slot,.search-ignore');
      if(!ignored||!root.contains(ignored))out.push(node);
    }
    return out;
  }
  function clear(root){for(const mark of root.querySelectorAll('mark.search-hit'))mark.replaceWith(...mark.childNodes);root.normalize?.()}
  function highlight(root,query,options={}){
    clear(root);if(!query)return [];
    const nodes=textNodes(root),runs=[];let offset=0;
    for(const node of nodes){runs.push({node,start:offset,end:offset+node.textContent.length});offset+=node.textContent.length}
    const hits=occurrences(nodes.map(n=>n.textContent).join(''),query,options),groups=hits.map(()=>[]);
    for(const run of runs){
      const parts=hits.map((h,i)=>({a:Math.max(h.start,run.start)-run.start,b:Math.min(h.end,run.end)-run.start,i})).filter(h=>h.a<h.b);
      if(!parts.length)continue;
      const frag=root.ownerDocument.createDocumentFragment();let cursor=0;
      for(const part of parts){frag.append(run.node.textContent.slice(cursor,part.a));const mark=root.ownerDocument.createElement('mark');mark.className='search-hit';mark.textContent=run.node.textContent.slice(part.a,part.b);mark.dataset.match=String(part.i);frag.append(mark);groups[part.i].push(mark);cursor=part.b}
      frag.append(run.node.textContent.slice(cursor));run.node.replaceWith(frag);
    }
    return groups.map(group=>group[0]).filter(Boolean);
  }
  function capture(container,canKeep=()=>true){
    if(typeof container.getBoundingClientRect!=='function')return {scrollTop:container.scrollTop};
    const box=container.getBoundingClientRect(),candidates=[];
    for(const article of container.querySelectorAll('article[data-node]')){
      if(!canKeep(article.dataset.node))continue;
      const elements=[...article.querySelectorAll('p,pre,li,h1,h2,h3,h4,h5,h6,summary')];
      if(!elements.length)elements.push(article);
      for(let i=0;i<elements.length;i++){
        const r=elements[i].getBoundingClientRect();if(!r.height)continue;
        candidates.push({node:article.dataset.node,index:elements[i]===article?-1:i,offset:r.top-box.top,visible:r.bottom>box.top&&r.top<box.bottom,distance:Math.abs(r.top-box.top)});
      }
    }
    return candidates.filter(c=>c.visible).sort((a,b)=>a.distance-b.distance)[0]||candidates.sort((a,b)=>a.distance-b.distance)[0]||{scrollTop:container.scrollTop};
  }
  function restore(container,anchor){
    if(!anchor)return;
    if(anchor.node&&typeof container.getBoundingClientRect==='function'){const article=[...container.querySelectorAll('article[data-node]')].find(a=>a.dataset.node===anchor.node);if(article){const elements=[...article.querySelectorAll('p,pre,li,h1,h2,h3,h4,h5,h6,summary')],target=anchor.index<0?article:elements[anchor.index]||article;container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top-anchor.offset;return}}
    if(anchor.scrollTop!==undefined)container.scrollTop=anchor.scrollTop;
  }

  function locateText(fields,needle,fraction=0,delta=0){
    const values=fields.map(f=>typeof f==='string'?f:String(f.value||'')),total=values.reduce((n,s)=>n+s.length,0),expected=Math.max(0,Math.min(1,fraction||0))*total;
    let best=null,base=0;
    for(let field=0;field<values.length;field++){
      const value=values[field],target=Math.max(0,Math.min(value.length,expected-base-delta)),candidates=needle?[value.lastIndexOf(needle,target),value.indexOf(needle,target)]:[];
      for(const at of new Set(candidates)){if(at<0)continue;const offset=Math.min(value.length,at+delta),distance=Math.abs(base+offset-expected);if(!best||distance<best.distance)best={field,offset,distance}}base+=value.length;
    }
    if(best)return {field:best.field,offset:best.offset};
    let remaining=expected;for(let field=0;field<values.length;field++){if(remaining<=values[field].length||field===values.length-1)return {field,offset:Math.min(values[field].length,Math.round(remaining))};remaining-=values[field].length}
    return {field:0,offset:0};
  }
  function editorAnchor(container,body,fields){
    if(!body||!container?.getBoundingClientRect||!body.getBoundingClientRect)return {field:0,offset:0};
    const doc=body.ownerDocument,box=container.getBoundingClientRect(),rect=body.getBoundingClientRect();
    const top=Math.max(rect.top+4,box.top+40),bottom=Math.min(rect.bottom,box.bottom??box.top+(container.clientHeight||600));
    if(bottom<=top)return {field:0,offset:0};const y=Math.min(top+4,bottom-1);let node,offset=0;
    for(const x of [rect.left+16,rect.left+(rect.width||300)*.4]){
      const caret=doc.caretPositionFromPoint?.(x,y),range=caret?null:doc.caretRangeFromPoint?.(x,y);const n=caret?.offsetNode||range?.startContainer;
      if(n?.nodeType===3&&body.contains(n)&&!n.parentElement?.closest('button,.katex,.math-slot,.reference-block')){node=n;offset=caret?.offset??range.startOffset;break}
    }
    if(!node){
      const blocks=[...body.querySelectorAll('p,pre,li,h1,h2,h3,h4,h5,h6,td')];const block=blocks.find(el=>{const r=el.getBoundingClientRect?.();return r&&r.bottom>y&&r.top<bottom})||body;
      const walker=doc.createTreeWalker(block,4);let next;while((next=walker.nextNode()))if(next.textContent.trim()&&!next.parentElement?.closest('button,.katex,.math-slot')){node=next;break}
    }
    let fraction=Math.max(0,Math.min(1,(y-rect.top)/Math.max(1,rect.height||rect.bottom-rect.top))),needle='',delta=0;
    if(node){const value=node.textContent,start=Math.max(0,offset-20);needle=value.slice(start,offset+60);delta=offset-start;
      try{const range=doc.createRange();range.selectNodeContents(body);range.setEnd(node,offset);fraction=range.toString().length/Math.max(1,body.textContent.length)}catch(_){}
    }
    return locateText(fields,needle,fraction,delta);
  }
  function positionTextarea(input,offset){
    const value=input.value,at=Math.max(0,Math.min(value.length,offset||0));input.focus?.({preventScroll:true});input.setSelectionRange?.(at,at);
    const doc=input.ownerDocument,style=doc?.defaultView?.getComputedStyle?.(input);
    if(style&&input.clientWidth){
      const mirror=doc.createElement('div');mirror.style.cssText='position:absolute;left:-100000px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;';
      for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','tabSize','padding','boxSizing'])mirror.style[key]=style[key];
      mirror.style.width=input.clientWidth+'px';mirror.append(doc.createTextNode(value.slice(0,at)));const marker=doc.createElement('span');marker.textContent='\u200b';mirror.append(marker);doc.body.append(mirror);
      input.scrollTop=Math.max(0,marker.offsetTop-mirror.offsetTop-2*(parseFloat(style.lineHeight)||20));mirror.remove();
    }else input.scrollTop=Math.max(0,(input.scrollHeight||0)-(input.clientHeight||0))*at/Math.max(1,value.length);
  }

  return {occurrences,wrap,highlight,clear,capture,restore,locateText,editorAnchor,positionTextarea};
});
