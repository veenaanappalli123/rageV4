import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {indexCorpus} from '../server/rag-core.js';
import {buildConceptGraph} from '../server/rag-v3-core.js';
const corpus=process.argv[2]||'kestrel';if(corpus!=='kestrel'){console.error('V3 graph extraction is required for Kestrel; second-corpus graph is optional.');process.exit(1);}
const chunks=indexCorpus(path.resolve('rag-data',corpus,'docs'),{size:800,overlap:120});
console.log(`Extracting graph from ${chunks.length} chunks. This uses the configured LLM and may incur API cost.`);
const graph=await buildConceptGraph(chunks,p=>{if(p.done%5===0||p.done===p.total)console.log(`${p.done}/${p.total} chunks processed`);});
graph.chunking={size:800,overlap:120};
fs.mkdirSync('rag-graphs',{recursive:true});fs.mkdirSync('rag-results',{recursive:true});fs.writeFileSync(path.join('rag-graphs',`${corpus}.json`),JSON.stringify(graph,null,2));
const triples=graph.edges.flatMap(e=>e.evidence.map(ev=>({subject:graph.nodes.find(n=>n.id===e.source)?.name,relation:e.relation,object:graph.nodes.find(n=>n.id===e.target)?.name,chunk_id:ev.chunk_id,quote:ev.quote,grade:'pending',notes:''})));
for(let i=triples.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[triples[i],triples[j]]=[triples[j],triples[i]];}
const sample=triples.slice(0,10).map(t=>({...t,source_text:chunks.find(c=>c.id===t.chunk_id)?.text||''}));
fs.writeFileSync('rag-results/kestrel-triples-to-grade.json',JSON.stringify(sample,null,2));
console.log(JSON.stringify({nodes:graph.nodes.length,edges:graph.edges.length,build:graph.build,triples_to_grade:sample.length},null,2));
