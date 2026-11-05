(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/re2js/build/index.cjs').RE2JS);else root.ViewerSearch=factory(root.RE2JS.RE2JS)})(globalThis,function(RE2){
  'use strict';
  const cache=new Map();
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function fold(value,diacritics){
    if(!diacritics)return {text:value,map:null};
    let text='',offset=0;const map=[];
    for(const char of value){const piece=char.normalize('NFD').replace(/\p{M}/gu,'');for(let i=0;i<piece.length;i++)map.push({start:offset,end:offset+char.length});text+=piece;offset+=char.length}
    return {text,map};
  }
  function compile(query,options={}){
    const key=JSON.stringify([query,options]);if(cache.has(key))return cache.get(key);
    if(query.length>1024)throw new Error('搜索表达式过长，请缩短到 1024 个字符以内');
    let pattern=fold(query,options.diacritics).text;
    if(options.mode==='wildcard')pattern=[...pattern].map(c=>c==='*'?'.*':c==='?'?'.':escape(c)).join('');
    else if(options.mode!=='regex')pattern=escape(pattern);
    let regex;try{regex=RE2.compile(pattern,RE2.MULTILINE|(options.caseSensitive?0:RE2.CASE_INSENSITIVE))}catch(error){throw new Error('搜索表达式无效：'+error.message)}
    const result={ranges(value,limit=20000){
      if(!query)return [];const original=String(value),normalized=fold(original,options.diacritics),matcher=regex.matcher(normalized.text),hits=[];
      let boundaries;
      if(options.wholeWord&&typeof Intl.Segmenter==='function'){
        boundaries=new Set();for(const part of new Intl.Segmenter(options.locale||undefined,{granularity:'word'}).segment(original)){boundaries.add(part.index);boundaries.add(part.index+part.segment.length)}
      }
      const isWord=char=>char&&/[\p{L}\p{N}_]/u.test(char);
      while(matcher.find()){
        let start=matcher.start(),end=matcher.end();if(start===end)continue;
        if(normalized.map){start=normalized.map[start]?.start??original.length;end=normalized.map[end-1]?.end??start}
        if(options.wholeWord&&(boundaries?!boundaries.has(start)||!boundaries.has(end):isWord(original.slice(0,start).at(-1))||isWord(original.slice(end)[0])))continue;
        hits.push({start,end});if(hits.length>=limit)break;
      }
      return hits;
    }};
    result.test=value=>result.ranges(value,1).length>0;
    if(cache.size>40)cache.clear();cache.set(key,result);return result;
  }
  const ranges=(value,query,options)=>compile(query,options).ranges(value);
  const test=(value,query,options)=>compile(query,options).ranges(value,1).length>0;
  return {compile,ranges,test};
});
