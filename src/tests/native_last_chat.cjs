/* Optional native Chromium regression. Start headless Edge with a temporary profile,
   then pass PROFILE_DIR, BAKED_HTML, OUTPUT_DIR. No network or private chats. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const [profile,html,output]=process.argv.slice(2),pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break}catch(_){}await pause(100)}if(!port)throw Error('Browser debugger did not start');
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),target=targets.find(t=>t.type==='page'),socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let serial=0;
 socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id&&pending.has(result.id)){const {resolve,reject}=pending.get(result.id);pending.delete(result.id);result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result)}});
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 const shot=async name=>{const result=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name),Buffer.from(result.data,'base64'))};
 fs.mkdirSync(output,{recursive:true});const report=[];
 try{
  await send('Page.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await send('Emulation.setDeviceMetricsOverride',{width:680,height:850,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:pathToFileURL(path.resolve(html)).href});
  let ready=false;for(let i=0;i<100;i++){ready=await evaluate(`document.querySelectorAll('#msgs article').length>0`);if(ready)break;await pause(100)}assert.ok(ready,'baked app loaded');await evaluate(`document.getElementById('language').value='zh-CN';document.getElementById('language').dispatchEvent(new Event('change'))`);
  await evaluate(`document.getElementById('theme').value='light';document.getElementById('theme').dispatchEvent(new Event('change'));document.getElementById('language').value='zh-CN';document.getElementById('language').dispatchEvent(new Event('change'))`);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
  const selected=await evaluate(`(()=>{const row=[...document.querySelectorAll('.conv-item')].find(el=>el.textContent.includes('Last chat B'));row.click();const c=document.getElementById('chat-container');c.scrollTop=600;return {title:document.getElementById('title').textContent,top:c.scrollTop}})()`);assert.equal(selected.title,'Last chat B');assert.ok(selected.top>400);
  await send('Page.navigate',{url:'about:blank'});await pause(100);await send('Page.navigate',{url:pathToFileURL(path.resolve(html)).href});
  let restored;for(let i=0;i<100;i++){restored=await evaluate(`document.getElementById('title')?{title:document.getElementById('title').textContent,top:document.getElementById('chat-container').scrollTop,hash:location.hash,active:document.querySelector('.conv-item.active')?.textContent}:null`);if(restored?.title==='Last chat B'&&restored.top>400)break;await pause(100)}assert.equal(restored.title,'Last chat B');assert.equal(restored.hash,'');assert.ok(restored.active.includes('Last chat B'));assert.ok(Math.abs(restored.top-selected.top)<=4);await shot('重新打开_自动恢复聊天与位置.png');
  fs.writeFileSync(path.join(output,'原生浏览器验证.json'),JSON.stringify({browser:'Microsoft Edge headless',action:'Navigate away then reopen the same HTML without a URL fragment',selected,restored,passed:true},null,2));console.log('Native Edge: last chat and reading position automatically restored on reopen without a URL fragment.');
 }finally{await send('Browser.close').catch(()=>{});socket.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
