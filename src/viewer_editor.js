(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.ViewerEditor=factory(root)})(globalThis,function(root){
  'use strict';
  async function imageData(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length>20*1024*1024)throw new Error('单张图片最大支持 20 MB');
    let mime=blob.type||'';
    if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78)mime='image/png';
    else if(bytes[0]===255&&bytes[1]===216)mime='image/jpeg';
    else if(String.fromCharCode(...bytes.slice(0,4))==='GIF8')mime='image/gif';
    else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
    if(!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime))throw new Error('请选择 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片');
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.slice(i,i+32768));
    return 'data:'+mime+';base64,'+root.btoa(binary);
  }
  function create(host,original,onError){
    if(!root.toastui?.Editor)throw new Error('离线编辑器未能加载');
    const language=({'zh-CN':'zh-CN','zh-TW':'zh-TW',ja:'ja-JP',ko:'ko-KR',fr:'fr-FR',de:'de-DE',es:'es-ES',pt:'pt-BR',ru:'ru-RU',ar:'ar'})[root.ViewerI18n?.locale()]||'en-US';
    const editor=new root.toastui.Editor({el:host,height:'420px',initialValue:original,initialEditType:'markdown',previewStyle:'vertical',language,usageStatistics:false,autofocus:false,theme:['dark','midnight','contrast'].includes(root.document?.body.dataset.theme)?'dark':undefined,
      linkAttributes:{target:'_blank',rel:'noopener noreferrer'},
      toolbarItems:[['heading','bold','italic','strike'],['hr','quote'],['ul','ol','task','indent','outdent'],['table','image','link'],['code','codeblock']],
      hooks:{addImageBlobHook:(blob,callback)=>{imageData(blob).then(url=>callback(url,blob.name||'插入图片')).catch(onError);return false}},
    });
    const baseline=editor.getMarkdown();
    function seek(offset){
      const fraction=(offset||0)/Math.max(1,original.length),needle=original.slice(offset,offset+60),mapped=root.ViewerNavigation?.locateText([baseline],needle,fraction).offset??Math.round(baseline.length*fraction);
      const lines=baseline.slice(0,mapped).split(/\r\n|\n|\r/),point=[lines.length,lines.at(-1).length+1];editor.setSelection?.(point,point);
      const selection=host.ownerDocument?.getSelection?.(),scroller=host.querySelector?.('.toastui-editor-md-container .ProseMirror');
      if(selection?.rangeCount&&host.contains(selection.anchorNode)&&scroller){const rect=selection.getRangeAt(0).getBoundingClientRect?.(),box=scroller.getBoundingClientRect?.();if(rect&&box)editor.setScrollTop?.(Math.max(0,editor.getScrollTop()+rect.top-box.top-36))}
    }
    return {seek,get:()=>{const value=editor.getMarkdown();return value===baseline?original:value},destroy:()=>editor.destroy(),editor};
  }
  return {create,imageData};
});
