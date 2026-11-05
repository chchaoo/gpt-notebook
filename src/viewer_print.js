(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.ViewerPrint=factory(root.ViewerCore,root.ViewerExports)})(globalThis,function(C,E){
  'use strict';
  function settings(input={}){
    const papers={A4:[210,297],A3:[297,420],Letter:[215.9,279.4],Legal:[215.9,355.6]},number=(x,min,max,label)=>{x=Number(x);if(!Number.isFinite(x)||x<min||x>max)throw new Error(label+'超出允许范围');return x};
    const paper=input.paper||'A4';if(!papers[paper]&&paper!=='custom')throw new Error('纸张格式无效');
    let [width,height]=papers[paper]||[number(input.width,50,500,'纸张宽度'),number(input.height,50,500,'纸张高度')];
    if(input.orientation==='landscape')[width,height]=[height,width];
    const margin=number(input.margin??18,0,40,'页边距'),font=number(input.font??11,8,24,'字体大小');
    if(width-2*margin<30||height-2*margin<30)throw new Error('页边距过大，剩余打印区域不足');
    return {...input,width,height,margin,font};
  }
  function css(options){const o=settings(options);return `
    .print-document{display:none}
    @page{size:${o.width}mm ${o.height}mm;margin:${o.margin}mm}
    @media print{
      html,body{height:auto!important;background:#fff!important;color:#111!important;overflow:visible!important;margin:0!important;padding:0!important}
      body>*:not(.print-document){display:none!important}
      .print-document{display:block!important;color:var(--text-primary)!important;background:var(--bg-main)!important;font-size:${o.font}pt!important;font-family:var(--print-family,system-ui,sans-serif)!important;line-height:1.65!important;direction:ltr;user-select:text;max-width:none!important;width:100%!important;padding:0!important;margin:0!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .print-document *{max-width:100%;box-sizing:border-box;text-shadow:none!important;box-shadow:none!important}
      .print-chat + .print-chat{break-before:page}
      .print-chat>.print-title{font-size:1.65em;margin:0 0 1em;overflow-wrap:anywhere}
      .print-message{margin:22px 0;orphans:3;widows:3}
      .print-role{color:var(--text-muted);margin:.7em 0 .25em;break-after:avoid;font-size:.7em}
      .print-document h1,.print-document h2,.print-document h3,.print-document h4{break-after:avoid}
      .print-document img{display:block;max-width:100%;max-height:${Math.max(30,o.height-2*o.margin-15)}mm;object-fit:contain;break-inside:avoid;margin:.6em 0}
      .print-document pre{white-space:pre-wrap!important;overflow-wrap:anywhere;background:var(--bg-code);color:var(--text-primary);font-size:.86em;max-height:none!important;overflow:visible!important}
      .print-document table{max-width:100%;table-layout:auto}.print-document td,.print-document th{overflow-wrap:anywhere}
      .print-document thead{display:table-header-group}.print-document tr{break-inside:avoid}
      .print-document a{color:var(--link);text-decoration:underline}.print-document .math-display{overflow:visible}
      .print-document button,.print-document .copy-code{display:none!important}.print-document p{orphans:3;widows:3}
      .print-document .msg.user .message-panel{margin-left:auto;max-width:85%}.print-document .msg.user .msg-content{background:var(--bg-msg-user)!important;padding:10px 20px;border-radius:16px;max-width:100%}
      .print-document .msg.assistant .msg-content{padding:4px 0}.print-document .katex{color:inherit!important}.print-document .msg .msg-content table{font-size:inherit}
    }`}
  async function build(records,input,environment){
    const options=settings(input),{document:doc,markdown,resources,resolveResource,branches}=environment;
    const container=doc.createElement('div');container.className='print-document msgs';container.id='print-document';
    for(const [name,value]of Object.entries(environment.palette||{}))if(/^--[a-z-]+$/.test(name)&&value)container.style.setProperty(name,value);
    if(environment.fontFamily)container.style.setProperty('--print-family',environment.fontFamily);
    const text=(tag,value)=>{const e=doc.createElement(tag);e.textContent=value;return e};
    for(const record of records){
      const section=doc.createElement('section');section.className='print-chat';const heading=text('h1',record.raw.title||'ChatGPT');heading.className='print-title';section.append(heading);
      for(const id of C.branch(record.raw,branches?.get(record.key)).ids){
        const message=C.nodeMap(record.raw)[id]?.message;if(!C.object(message))continue;
        const info=C.classification(message);if(info.thought&&!options.thoughts||info.tool&&!options.tools)continue;
        const article=doc.createElement('article');article.className='print-message msg '+info.role;const role=info.thought?'思考记录':({user:'用户',assistant:'助手',tool:'工具',system:'系统'})[info.role]||info.role;
        const header=text('div',environment.translate?environment.translate(role):role);header.className='print-role message-header';article.append(header);
        for(const block of C.blocks(message)){
          if(block.type==='markdown'){const node=markdown(block.text,message);for(const button of node.querySelectorAll('button'))button.remove();article.append(node)}
          else if(block.type==='asset'){
            const entry=resources.get(block.id),name=block.name||entry?.name||block.id;
            if(entry){const {blob,mime}=await resolveResource(entry,name,block.mime);if(/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)){const image=doc.createElement('img');image.src='data:'+mime+';base64,'+await E.base64(blob);image.alt=name;article.append(image)}else article.append(text('p','📎 '+name))}
            else article.append(text('p','📎 '+name+'（缺失）'));
          }else if(block.type==='link')article.append(text('p',block.text+' — '+block.url));
          else article.append(text('pre',block.text));
        }
        const references=C.references(message);if(references.length){const list=doc.createElement('ul');for(const reference of references){const item=doc.createElement('li'),href=C.safeURL(reference.url);if(href){const link=text('a',reference.title||href);link.href=href;item.append(link)}else item.append(text('span',reference.title||reference.url));list.append(item)}article.append(list)}
        const panel=doc.createElement('div');panel.className='message-panel';const body=doc.createElement('div');body.className='msg-content';for(const child of [...article.childNodes])if(child!==header)body.append(child);panel.append(header,body);article.replaceChildren(panel);section.append(article);
      }
      container.append(section);
    }
    return {element:container,style:css(options),options};
  }
  return {settings,css,build};
});
