import fs from 'node:fs';
import path from 'node:path';
import { indexCorpus, loadQuestions } from '../server/rag-core.js';
import { bm25Search, denseSearch, graphSearch, reciprocalRankFusion } from '../server/rag-v3-core.js';
import { expandQuery, rerankResults, assessConfidence } from '../server/rag-v4-core.js';

const corpus = process.argv[2] || 'kestrel';
const root = path.resolve('rag-data');
const graphFile = path.resolve('rag-graphs', `${corpus}.json`);
const out = path.resolve('rag-results');
const chunks = indexCorpus(path.join(root, corpus, 'docs'), { size: 800, overlap: 120 });
const questions = loadQuestions(path.join(root, corpus, 'questions.jsonl'));
const useGraph = process.argv.includes('--graph');
let graph;
if (useGraph) {
  if (!fs.existsSync(graphFile)) throw Error(`Missing graph ${graphFile}; build it first.`);
  graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
}

const rows = [];
for (const q of questions) {
  const started = Date.now();
  const variants = expandQuery(q.question);
  const lists = {};
  for (let i = 0; i < variants.length; i++) {
    const perQuery = {};
    perQuery.dense = await denseSearch(chunks, variants[i], 15);
    perQuery.bm25 = bm25Search(chunks, variants[i], 15);
    if (graph) perQuery.graph = graphSearch(chunks, variants[i], graph, 15).hits;
    lists[`query_${i + 1}`] = reciprocalRankFusion(perQuery, 15);
  }
  const fused = reciprocalRankFusion(lists, 15);
  const ranked = rerankResults(q.question, fused, { limit: 10 });
  const confidence = assessConfidence(q.question, ranked);
  const relevant = chunks.filter(c => (q.evidence || []).some(e => (e.source || e.document || '').split('/').pop() === c.source.split('/').pop() && (!e.quote || c.text.includes(e.quote))));
  const ranks = [1,3,5,10].map(k => {
    const found = ranked.slice(0,k).filter(h => relevant.some(r => r.id === h.id));
    return { k, hit: found.length ? 1 : 0, recall: relevant.length ? found.length / relevant.length : null };
  });
  rows.push({ id:q.id, type:q.type, answerable:q.answerable, query_variants:variants, relevant_chunk_ids:relevant.map(c=>c.id), retrieved:ranked, confidence, ranks, latency_ms:Date.now()-started });
}
const eligible = rows.filter(r => r.answerable && r.relevant_chunk_ids.length);
const metrics = Object.fromEntries([1,3,5,10].flatMap(k => [[`hit_rate_at_${k}`, eligible.length ? eligible.reduce((s,r)=>s+r.ranks.find(x=>x.k===k).hit,0)/eligible.length : null],[`recall_at_${k}`,eligible.length ? eligible.reduce((s,r)=>s+(r.ranks.find(x=>x.k===k).recall||0),0)/eligible.length : null]]));
fs.mkdirSync(out,{recursive:true});
const report = { version:4, corpus, generated_at:new Date().toISOString(), configuration:{chunk_size:800,overlap:120,query_expansion:true,dense:true,bm25:true,graph:!!graph,reranking:true,confidence_threshold:0.16}, summary:{questions:rows.length,answerable:rows.filter(r=>r.answerable).length,excluded_unanswerable:rows.filter(r=>!r.answerable).length,low_confidence:rows.filter(r=>!r.confidence.confident).length,...metrics}, rows };
const filename=`v4-${corpus}-${Date.now()}.json`;
fs.writeFileSync(path.join(out,filename),JSON.stringify(report,null,2));
console.log(`Saved rag-results/${filename}`);
console.log(`Questions: ${rows.length}; eligible: ${eligible.length}; low-confidence: ${report.summary.low_confidence}`);
for (const k of [1,3,5,10]) console.log(`HitRate@${k}: ${(metrics[`hit_rate_at_${k}`]*100).toFixed(1)}% | Recall@${k}: ${(metrics[`recall_at_${k}`]*100).toFixed(1)}%`);
