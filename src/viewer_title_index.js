(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/pinyin-pro/dist/index.js'));else root.ViewerTitleIndex=factory(root.pinyinPro)})(globalThis,function(Pinyin){
  'use strict';
  const cache=new Map(),collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'}),letters=['#',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  function info(value){
    value=String(value).trim();if(cache.has(value))return cache.get(value);
    const key=Pinyin.pinyin(value,{toneType:'none',type:'array',nonZh:'consecutive'}).join('').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
    const first=key.charAt(0).toUpperCase(),group=/^[A-Z]$/.test(first)?first:'#',result={key,group};
    if(cache.size>5000)cache.clear();cache.set(value,result);return result;
  }
  function compare(a,b){const x=info(a),y=info(b);return letters.indexOf(x.group)-letters.indexOf(y.group)||collator.compare(x.key,y.key)||String(a).localeCompare(String(b),'zh-CN')}
  return {info,compare,letters};
});
