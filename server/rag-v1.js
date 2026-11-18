import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { indexCorpus, generateAnswer } from './rag-core.js';
import { denseSearch } from './rag-v3-core.js';

const root = path.resolve('rag-data');
const port = Number(process.env.RAG_PORT || 3100);
const send = (res, status, value, type='application/json') => {
  res.writeHead(status, {'Content-Type': type, 'Access-Control-Allow-Origin': '*'});
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
};
const readBody = async req => {
  let raw='';
  for await (const part of req) { raw += part; if (raw.length > 2_000_000) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
};
const validName = value => typeof value === 'string' && /^[a-z0-9_-]{1,69}$/i.test(value);
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAG V1 — Naive baseline</title><style>body{font:16px/1.5 system-ui;margin:36px auto;padding:0 18px;max-width:900px;background:#f5f7fb;color:#182235}main{background:white;padding:24px;border:1px solid #dce2eb;border-radius:12px}label{display:block;margin:12px 0 5px}input,select,textarea,button{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:6px}textarea{width:100%;min-height:110px;box-sizing:border-box}button{background:#2155b6;color:white;border:0;cursor:pointer;margin-top:14px}pre{white-space:pre-wrap;background:#f1f5f9;padding:14px;border-radius:8px}.muted{color:#64748b}.source{border:1px solid #dce2eb;border-radius:8px;padding:12px;margin:10px 0}</style></head><body><main><h1>RAG V1 — Naive baseline</h1><p class="muted">A simple retrieve-then-answer pipeline. Select a corpus, ask a question, and inspect the retrieved passages.</p><label for="corpus">Document corpus</label><select id="corpus"><option value="kestrel">Kestrel</option><option value="personal">Personal</option></select><label for="question">Your question</label><textarea id="question" placeholder="Ask a question about the selected documents..."></textarea><label>Chunk size <input id="size" type="number" min="100" max="4000" value="800"></label><label>Chunk overlap <input id="overlap" type="number" min="0" max="3999" value="120"></label><label>Top-k passages <input id="k" type="number" min="1" max="10" value="5"></label><label><input id="generate" type="checkbox"> Generate a grounded answer (requires LLM credentials in .env)</label><button id="ask">Ask</button><p id="status" class="muted"></p><section id="answer"></section><section id="sources"></section></main><script>const $=id=>document.getElementById(id);$('ask').onclick=async()=>{const question=$('question').value.trim();if(!question){$('status').textContent='Please enter a question.';return;}$('ask').disabled=true;$('status').textContent='Retrieving passages...';$('answer').innerHTML='';$('sources').innerHTML='';try{const r=await fetch('/api/rag/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({corpus:$('corpus').value,question,size:Number($('size').value),overlap:Number($('overlap').value),k:Number($('k').value),generate:$('generate').checked})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');if(data.answer){$('answer').innerHTML='<h2>Grounded answer</h2><pre></pre>'; $('answer').querySelector('pre').textContent=data.answer.answer;$('status').textContent='Answer generated. Check its source references below.';}else{$('status').textContent='Retrieved '+data.retrieved.length+' passage(s). Add LLM credentials and enable answer generation for a written answer.';}if(data.retrieved.length){$('sources').innerHTML='<h2>Retrieved references</h2>'+data.retrieved.map((x,i)=>'<article class="source"><strong>['+(i+1)+'] '+x.source+'</strong><div class="muted">Chunk '+x.id+' · score '+x.score.toFixed(4)+'</div><pre></pre></article>').join('');[...$('sources').querySelectorAll('pre')].forEach((el,i)=>el.textContent=data.retrieved[i].text);}else $('sources').innerHTML='<p>No matching passages found in this corpus.</p>';if(data.answer?.citations?.length)$('status').textContent+=' Cited chunk IDs: '+data.answer.citations.join(', ');}catch(e){$('status').textContent='Error: '+e.message;}finally{$('ask').disabled=false;}};</script></body></html>`;

async function route(req,res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method==='GET' && (url.pathname==='/' || url.pathname==='/rag')) return send(res,200,page,'text/html; charset=utf-8');
    if (req.method==='GET' && url.pathname==='/api/rag/corpora') {
      const names=fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);
      return send(res,200,names.map(name=>({name,documents:fs.existsSync(path.join(root,name,'docs'))?fs.readdirSync(path.join(root,name,'docs')).filter(f=>/\.(md|txt)$/i.test(f)).length:0})));
    }
    if (req.method==='POST' && url.pathname==='/api/rag/ask') {
      const p=await readBody(req);
      if(!validName(p.corpus)) throw new Error('Choose a valid corpus.');
      if(typeof p.question!=='string'||!p.question.trim()) throw new Error('Question required.');
      const size=Number(p.size??800),overlap=Number(p.overlap??120),k=Math.min(10,Math.max(1,Number(p.k)||5));
      let chunks=indexCorpus(path.join(root,p.corpus,'docs'),{size,overlap});
      if(Array.isArray(p.documents)) chunks=chunks.filter(c=>p.documents.includes(c.source));
      const retrieved=await denseSearch(chunks,p.question,k);
      let answer=null;
      if(p.generate) answer=await generateAnswer(p.question,retrieved);
      return send(res,200,{version:1,retriever:'dense',retrieved,answer,notice:'V1 baseline: one dense retriever, no BM25, graph, or rank fusion.'});
    }
    return send(res,404,{error:'Not found'});
  } catch(error) { return send(res,400,{error:error.message}); }
}
http.createServer(route).listen(port,()=>console.log(`RAG V1: http://localhost:${port}`));
