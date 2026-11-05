/* Markdown policy shared by the browser and offline tests. MIT. */
(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.ViewerMarkdown = factory(root.ViewerCore, root.marked);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(C, marked) {
  'use strict';
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const renderer = new marked.Renderer();
  const parser = new marked.Marked();
  const slot = (tex,display) => '<span class="math-slot" data-tex="' + encodeURIComponent(tex) + '" data-display="' + (display?'1':'0') + '">' + escape(tex) + '</span>';

  let context = {};
  function reference(id) {
    const metadata=context.message?.metadata||{},list=x=>Array.isArray(x)?x:[],items=[...list(metadata.content_references),...list(metadata.search_result_groups).flatMap(g=>list(g?.entries))];
    return items.find(x=>x&&[x.ref_id,x.reference_id,x.source_ref_id,...(Array.isArray(x.ref_ids)?x.ref_ids:[])].includes(id)&&C.safeURL(x.url));
  }
  function citationHTML(ids){
    return '<sup>'+ids.map((id,i)=>{const ref=reference(id);return ref?'<a href="'+escape(ref.url)+'" title="'+escape(ref.title||id)+'" target="_blank" rel="noopener noreferrer">['+(i+1)+']</a>':'<span class="export-citation" title="'+escape(id)+'">['+(i+1)+']</span>'}).join(' ')+'</sup>';
  }
  function exportedTag(src) {
    const match=/^<(Cite|Link)\b((?:[^>"']|"[^"]*"|'[^']*')*)\/>/.exec(src);
    if(!match)return null;
    if(match[1]==='Cite'){
      const attrs=match[2],refs=/^\s*refs\s*=\s*\{(\[[\s\S]*\])\}\s*$/.exec(attrs);
      const single=/^\s*ref\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|\{("(?:\\.|[^"\\])*")\})\s*$/.exec(attrs);
      if(!refs&&!single)return null;
      let ids;try{ids=refs?JSON.parse(refs[1]):[single[3]?JSON.parse(single[3]):single[1]??single[2]]}catch(_){return null}
      if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!id.trim()||id.length>300))return null;
      return {raw:match[0],html:citationHTML(ids)};
    }
    const attrs={},rest=match[2].replace(/\b(url|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,(_,key,a,b)=>{attrs[key]=a??b;return ''});
    if(rest.trim()||typeof attrs.url!=='string')return null;
    const url=C.safeURL(attrs.url),label=escape(attrs.title||attrs.url);
    return {raw:match[0],html:url?'<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':label};
  }

  parser.use({extensions:[

    // Core.displayText converts native cite delimiters to this readable form.
    // Tokenize it as Markdown so inline/fenced code remains literal.
    {name:'nativeCitation',level:'inline',start(src){const i=src.indexOf('〔引用：');return i<0?undefined:i},tokenizer(src){
      if(this.lexer.state.inLink)return;
      const match=/^〔引用：([^\r\n〕]{1,30100})〕/.exec(src);if(!match)return;
      const ids=match[1].split('、').map(id=>id.trim());
      if(ids.length>100||ids.some(id=>!/^turn\d+[a-z]+\d+(?:-[\w-]+)?$/i.test(id)||id.length>300))return;
      return {type:'nativeCitation',raw:match[0],ids};
    },renderer(token){return citationHTML(token.ids)}},

    {name:'exportedTag',level:'inline',start(src){const i=src.search(/<(?:Cite|Link)\b/);return i<0?undefined:i},tokenizer(src){const found=exportedTag(src);if(found)return {type:'exportedTag',...found}},renderer(token){return token.html}},
    {name:'exportedChoices',level:'block',start(src){const i=src.search(/^\{@body\b/m);return i<0?undefined:i},tokenizer(src){
      if(!src.startsWith('{@body'))return;
      const end=src.indexOf('</box>');if(end<0||end>150000)return;
      let raw=src.slice(0,end+6);if(src[raw.length]==='}')raw+='}';
      if(!/<radio-group\b/.test(raw))return;
      const choices=[...raw.matchAll(/<radio(?=\s|>)[^>]*>\s*([\s\S]*?)\s*<\/radio>/g)].map(m=>m[1].replace(/<[^>]*>/g,'').trim());
      if(!choices.length||choices.length>100)return;
      return {type:'exportedChoices',raw,choices};
    },renderer(token){return '<ul>'+token.choices.map(value=>'<li>'+escape(value)+'</li>').join('')+'</ul>'}},

    {name:'displayMath',level:'block',start(src){const i=src.search(/(?:\$\$|\\\[)/);return i<0?undefined:i},tokenizer(src){
      const m=/^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)?/.exec(src);if(m)return {type:'displayMath',raw:m[0],tex:m[1]||m[2]};
    },renderer(token){return '<div class="math-display">'+slot(token.tex,true)+'</div>'}},
    {name:'inlineMath',level:'inline',start(src){const i=src.search(/(?:\\\(|\$)/);return i<0?undefined:i},tokenizer(src){
      const m=/^(?:\\\(([^\n]+?)\\\)|\$(?!\s|\$)((?:\\.|[^\n$])+?)(?<!\s)\$(?!\d))/.exec(src);if(m)return {type:'inlineMath',raw:m[0],tex:m[1]||m[2]};
    },renderer(token){return slot(token.tex,false)}},
    {name:'writingDocument',level:'block',start(src){const i=src.search(/^:::writing\{/m);return i<0?undefined:i},tokenizer(src){
      const m=/^:::writing\{[^\n]*\}\s*\n([\s\S]*?)(?:\n:::(?:\n|$)|$)/.exec(src);if(m)return {type:'writingDocument',raw:m[0],tokens:this.lexer.blockTokens(m[1])};
    },renderer(token){return this.parser.parse(token.tokens)}},
  ]});
  renderer.html = ({text}) => {const found=exportedTag(text.trim());return found&&found.raw===text.trim()?found.html:escape(text)};
  renderer.checkbox = ({checked}) => checked ? '☑ ' : '☐ ';
  renderer.link = function({href,tokens}) {
    const label = this.parser.parseInline(tokens), url = C.safeURL(href);
    return url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
  };
  renderer.image = function({href,text}) {
    const resource = C.safeURL(href,'resource');
    if (resource) return '<img src="' + escape(resource) + '" alt="' + escape(text) + '" loading="lazy">';
    const url = C.safeURL(href);
    const ui=key=>'<span data-viewer-ui="'+key+'">'+key+'</span>';return url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">'+ui('外部图片：') + (text?escape(text):ui('点击打开')) + '</a>' : ui('[图片地址已阻止]');
  };
  return {
    render(value, options = {}) {
      const previous=context;context=options;try{return parser.parse(C.displayText(value), { gfm:true, breaks:Boolean(options.breaks), async:false, renderer })}finally{context=previous}
    }, escape,
  };
});
