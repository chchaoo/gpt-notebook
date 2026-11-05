/* ChatGPT Viewer: data model and exact-text editing. MIT. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViewerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FILE_RE = /(?:^|[^\w])(file[-_][A-Za-z0-9]{8,})(?=[^A-Za-z0-9]|$)/;
  const key = path => JSON.stringify(path);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const timestamp = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const conversationFile = name => /^conversations(?:-[^/]+)?\.json$/i.test(name);
  function fid(value) { return typeof value === 'string' ? (FILE_RE.exec(value) || [])[1] || null : null; }
  function get(object, path) { for (const part of path) { if (object == null) return undefined; object = object[part]; } return object; }
  function set(object, path, value) {
    let parent = object;
    for (const part of path.slice(0, -1)) parent = parent[part];
    parent[path[path.length - 1]] = value;
  }
  function parse(text) { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  function document(text, data) {
    const value = data === undefined ? parse(text) : data;
    if (!Array.isArray(value)) throw new Error('聊天 JSON 顶层必须是数组');
    return { text, data: value, changes: new Map(), originals: new Map() };
  }
  function change(doc, path, value) {
    if (typeof value !== 'string') throw new Error('只支持修改文字字段');
    const current = get(doc.data, path);
    if (typeof current !== 'string') throw new Error('原字段不是文字，不能直接替换');
    const id = key(path);
    if (!doc.originals.has(id)) doc.originals.set(id, current);
    if (value === doc.originals.get(id)) doc.changes.delete(id);
    else doc.changes.set(id, { path: path.slice(), value });
    set(doc.data, path, value);
    return current;
  }
  // Scan JSON lexical spans without serializing untouched values. In particular,
  // integers outside JS's safe range and unknown metadata remain verbatim.
  function spans(text, wanted) {
    let p = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const found = new Map();
    const ws = () => { while (/\s/.test(text[p] || '') && p < text.length) p++; };
    function stringEnd() {
      const start = p++;
      while (p < text.length) {
        const ch = text[p++];
        if (ch === '\\') p++;
        else if (ch === '"') return start;
      }
      throw new Error('JSON 字符串不完整');
    }
    function value(path, depth) {
      if (depth > 512) throw new Error('JSON 嵌套层级过深');
      ws(); const start = p, ch = text[p];
      if (ch === '{') {
        p++; ws();
        if (text[p] !== '}') while (true) {
          ws(); if (text[p] !== '"') throw new Error('JSON 对象字段无效');
          const a = stringEnd();
          const name = JSON.parse(text.slice(a, p));
          ws(); if (text[p++] !== ':') throw new Error('JSON 缺少冒号');
          value(path.concat(name), depth + 1); ws();
          if (text[p] !== ',') break;
          p++;
        }
        if (text[p++] !== '}') throw new Error('JSON 对象不完整');
      } else if (ch === '[') {
        p++; ws(); let i = 0;
        if (text[p] !== ']') while (true) {
          value(path.concat(i++), depth + 1); ws();
          if (text[p] !== ',') break;
          p++;
        }
        if (text[p++] !== ']') throw new Error('JSON 数组不完整');
      } else if (ch === '"') stringEnd();
      else {
        while (p < text.length && !/[\s,}\]]/.test(text[p])) p++;
        if (p === start) throw new Error('JSON 值无效');
      }
      const id = key(path);
      if (wanted===null||wanted.has(id)) found.set(id, [start, p]);
    }
    value([], 0); ws();
    if (p !== text.length) throw new Error('JSON 末尾有额外内容');
    return found;
  }
  function patch(text, edits, known) {
    if (!edits.length) return text;
    const found = known||spans(text, new Set(edits.map(e => key(e.path))));
    const replacements = edits.map(e => {
      const span = found.get(key(e.path));
      if (!span) throw new Error('找不到原始字段；为避免破坏数据，已停止导出');
      return { start: span[0], end: span[1], value: JSON.stringify(e.value) };
    }).sort((a, b) => b.start - a.start);
    let last = text.length;
    for (const edit of replacements) {
      if (edit.end > last) throw new Error('修改字段相互重叠');
      text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
      last = edit.start;
    }
    return text;
  }
  const serialize = doc => patch(doc.text, [...doc.changes.values()]);
  function nodeMap(c) { return object(c.mapping) ? c.mapping : {}; }
  function branch(c, requested) {
    const nodes = nodeMap(c), ids = Object.keys(nodes).filter(id => object(nodes[id]));
    const has = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(nodes, id) && object(nodes[id]);
    const parents = new Set(ids.map(id => nodes[id].parent).filter(has));
    const leaves = ids.filter(id => !parents.has(id));
    const rank = id => timestamp(nodes[id].message && nodes[id].message.create_time);
    leaves.sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
    let leaf = has(requested) ? requested : has(c.current_node) ? c.current_node : leaves[0] || ids[0];
    const warnings = [], path = [], seen = new Set();
    if (requested === '__all__') {
      ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      return { ids, leaves, leaf: '__all__', warnings };
    }
    if (c.current_node && !has(c.current_node)) warnings.push('原数据的 current_node 无效，已选择一个可用分支');
    let cur = leaf;
    while (has(cur)) {
      if (seen.has(cur)) { warnings.push('原数据存在循环父节点引用'); break; }
      seen.add(cur); path.push(cur);
      const parent = nodes[cur].parent;
      if (parent && !has(parent)) warnings.push('原数据有缺失的父节点引用');
      cur = parent;
    }
    return { ids: path.reverse(), leaves, leaf, warnings };
  }
  function classification(message) {
    const content = object(message.content) ? message.content : {};
    const role = (message.author || {}).role || 'unknown';
    const type = content.content_type || 'unknown';
    const thought = ['thoughts', 'reasoning_recap'].includes(type);
    const recipient = message.recipient || (message.metadata || {}).recipient;
    const tool = ['tool', 'function', 'system', 'developer'].includes(role)
      || ['code', 'execution_output', 'computer_output', 'tether_quote', 'tether_browsing_display',
        'sonic_webpage', 'system_error', 'user_editable_context'].includes(type)
      || Boolean(recipient && recipient !== 'all')
      || Array.isArray(message.tool_calls) || Array.isArray(content.tool_calls);
    return { role, type, thought, tool };
  }
  function fence(text, language) {
    text = String(text || '');
    const longest = [...text.matchAll(/`+/g)].reduce((n,m) => Math.max(n,m[0].length + 1),3);
    const edge = '`'.repeat(longest);
    return edge + String(language || '').replace(/[\r\n]/g, '') + '\n' + text + '\n' + edge;
  }
  function blocks(message) {
    const c = object(message.content) ? message.content : {}, out = [], used = new Set();
    const md = text => { if (typeof text === 'string' && text.trim()) out.push({ type: 'markdown', text }); };
    const asset = (pointer, name, mime, kind) => {
      const id = fid(pointer);
      if (id && !used.has(id)) { used.add(id); out.push({ type: 'asset', id, name: name || '', mime: mime || '', kind }); }
    };
    switch (c.content_type) {
      case 'text': case 'multimodal_text': {
        let buffer = '';
        const flush = () => { md(buffer); buffer = ''; };
        for (const part of Array.isArray(c.parts) ? c.parts : []) {
          if (typeof part === 'string') { buffer += part; continue; }
          if (!object(part)) continue;
          flush();
          if (part.content_type === 'image_asset_pointer') asset(part.asset_pointer, '', '', 'image');
          else if (part.content_type === 'audio_asset_pointer') asset(part.asset_pointer, '', '', 'audio');
          else if (part.content_type === 'audio_transcription') md(part.text);
          else if (part.content_type === 'real_time_user_audio_video_asset_pointer') asset((part.audio_asset_pointer || {}).asset_pointer, '', '', 'audio');
          else if (fid(part.asset_pointer || part.file_id || part.id)) asset(part.asset_pointer || part.file_id || part.id, part.name, part.mime_type);
          else out.push({ type: 'raw', text: JSON.stringify(part, null, 2) });
        }
        flush(); break;
      }
      case 'code': md(fence(c.text, c.language)); break;
      case 'execution_output': md(fence(c.text)); break;
      case 'thoughts':
        for (const thought of Array.isArray(c.thoughts) ? c.thoughts : []) {
          if (!object(thought)) continue;
          md((thought.summary ? '**' + thought.summary + '**\n\n' : '') + (thought.content || ''));
        }
        break;
      case 'reasoning_recap': md(c.content); break;
      case 'tether_quote': md(c.text); if (c.url) out.push({ type: 'link', url: c.url, text: c.title || c.url }); break;
      case 'tether_browsing_display': md(c.result || c.summary); break;
      case 'sonic_webpage': md(c.text || c.result); break;
      case 'system_error': md(c.text); break;
      case 'computer_output':
        if ((c.state || {}).current_url) out.push({ type: 'link', url: c.state.current_url, text: c.state.current_url });
        asset((c.screenshot || {}).asset_pointer, '', '', 'image'); break;
      case 'user_editable_context': md(c.user_instructions); md(c.user_profile); break;
      default: out.push({ type: 'raw', text: JSON.stringify(c, null, 2) });
    }
    for (const attachment of Array.isArray((message.metadata || {}).attachments) ? message.metadata.attachments : []) {
      if (object(attachment)) asset(attachment.id || attachment.file_id, attachment.name, attachment.mime_type);
    }
    if (message.tool_calls) out.push({ type: 'raw', text: JSON.stringify(message.tool_calls, null, 2) });
    if (c.tool_calls) out.push({ type: 'raw', text: JSON.stringify(c.tool_calls, null, 2) });
    return out;
  }
  function editable(message) {
    const c = object(message.content) ? message.content : {}, result = [];
    const add = (path, label) => { const value = get(c, path); if (typeof value === 'string') result.push({ path: ['content', ...path], label, value }); };
    if (Array.isArray(c.parts)) c.parts.forEach((p, i) => { if (typeof p === 'string') add(['parts', i], '正文 ' + (i + 1)); });
    for (const name of ['text', 'content', 'result', 'summary', 'user_instructions', 'user_profile']) add([name], name);
    if (Array.isArray(c.thoughts)) c.thoughts.forEach((t, i) => {
      if (object(t)) { add(['thoughts', i, 'summary'], '摘要 ' + (i + 1)); add(['thoughts', i, 'content'], '内容 ' + (i + 1)); }
    });
    return result;
  }
  function searchText(c) {
    return Object.values(nodeMap(c)).filter(object).map(n => n.message ? blocks(n.message).map(b => b.text || b.name || '').join('\n') : '').join('\n').toLowerCase();
  }
  function references(message) {
    const metadata = message.metadata || {}, found = new Map();
    const add = x => { if (object(x) && typeof x.url === 'string') found.set(x.url, { url: x.url, title: x.title || x.url }); };
    for (const x of Array.isArray(metadata.content_references) ? metadata.content_references : []) add(x);
    for (const group of Array.isArray(metadata.search_result_groups) ? metadata.search_result_groups : [])
      for (const x of Array.isArray((group || {}).entries) ? group.entries : []) add(x);
    return [...found.values()];
  }
  function safeURL(value, kind = 'link') {
    if (typeof value !== 'string') return null;
    value = value.trim();
    if (/[\u0000-\u0020\u007f]/.test(value)) return null;
    if (kind === 'resource') return /^blob:/.test(value) || /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(value) ? value : null;
    return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : null;
  }
  function displayText(value) {
    return String(value).replace(/cite([\s\S]*?)/g, (_, ids) => '〔引用：' + ids.replace(//g, '、') + '〕')
      .replace(/[-]/g, '');
  }
  function combineSources(texts) {
    return '[' + texts.map(text => {
      const t = text.replace(/^\uFEFF/, '').trim();
      if (t[0] !== '[' || t[t.length - 1] !== ']') throw new Error('聊天 JSON 必须是数组');
      return t.slice(1, -1).trim();
    }).filter(Boolean).join(',\n') + ']';
  }
  function syncChatHTML(text, json) {
    const match = /\bvar\s+jsonData\s*=\s*/.exec(text);
    if (!match) throw new Error('chat.html 格式不受支持，无法同步；请保留原包并单独导出 JSON');
    const start = match.index + match[0].length;
    if (text[start] !== '[') throw new Error('chat.html 的 jsonData 不是数组');
    let p = start, depth = 0, inString = false, escape = false;
    for (; p < text.length; p++) {
      const ch = text[p];
      if (inString) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') inString = false; }
      else if (ch === '"') inString = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') { if (--depth === 0) { p++; break; } }
    }
    if (depth !== 0) throw new Error('chat.html 内嵌数据不完整');
    return text.slice(0, start) + json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + text.slice(p);
  }
  function validPath(path) {
    if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[\u0000-\u001f]/.test(path)) return false;
    return path.split('/').every(x => x && x !== '.' && x !== '..');
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(data) { let n = 0xFFFFFFFF; for (const b of data) n = crcTable[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xFFFFFFFF) >>> 0; }
  function header(length, values) {
    const a = new Uint8Array(length), d = new DataView(a.buffer);
    for (const [offset, value, size] of values) size === 2 ? d.setUint16(offset, value, true) : d.setUint32(offset, value, true);
    return a;
  }
  async function zip(entries, progress = () => {}) {
    if (entries.length > 65535) throw new Error('文件过多，当前 ZIP 导出最多支持 65535 个文件');
    const locals = [], central = [], seen = new Set(); let offset = 0, count = 0;
    for (const entry of entries) {
      if (!validPath(entry.path) || seen.has(entry.path)) throw new Error('ZIP 文件路径无效或重复：' + entry.path);
      seen.add(entry.path);
      const name = new TextEncoder().encode(entry.path);
      const blob = entry.blob instanceof Blob ? entry.blob : new Blob([entry.blob]);
      if (blob.size > 0xFFFFFFFF || offset + blob.size > 0xFFFFFFFF || name.length > 65535) throw new Error('导出超过普通 ZIP 的大小限制');
      const bytes = new Uint8Array(await blob.arrayBuffer()), crc = crc32(bytes);
      const local = header(30, [[0,0x04034B50,4],[4,20,2],[6,0x800,2],[12,33,2],[14,crc,4],[18,blob.size,4],[22,blob.size,4],[26,name.length,2]]);
      const dir = header(46, [[0,0x02014B50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc,4],[20,blob.size,4],[24,blob.size,4],[28,name.length,2],[42,offset,4]]);
      locals.push(local, name, blob); central.push(dir, name);
      offset += 30 + name.length + blob.size;
      progress(++count, entries.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const size = central.reduce((n, a) => n + a.byteLength, 0);
    if (offset + size > 0xFFFFFFFF) throw new Error('导出超过普通 ZIP 的大小限制');
    const end = header(22, [[0,0x06054B50,4],[8,count,2],[10,count,2],[12,size,4],[16,offset,4]]);
    return new Blob([...locals, ...central, end], { type: 'application/zip' });
  }
  return { object, timestamp, conversationFile, fid, get, key, parse, document, change, spans, patch, serialize,
    nodeMap, branch, classification, blocks, editable, searchText, references, safeURL, displayText,
    combineSources, syncChatHTML, validPath, crc32, zip };
});
