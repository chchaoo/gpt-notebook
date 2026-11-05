const Store=require('../viewer_journal_store.js');
async function readHistory(fs){return Store.create().open(new Map([...fs.files].map(([path,blob])=>[path,{path,blob}])))}
async function historyText(fs){return (await Promise.all([...fs.files].filter(([p])=>p===Store.path||Store.managed(p)).map(async([,b])=>b.text()))).join('\n')}
module.exports={readHistory,historyText};
