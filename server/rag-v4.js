import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { indexCorpus, generateAnswer } from './rag-core.js';
import { bm25Search, denseSearch, graphSearch, reciprocalRankFusion } from './rag-v3-core.js';
import { expandQuery, rerankResults, assessConfidence, validateCitations } from './rag-v4-core.js';

const root = path.resolve('rag-data');
const graphs = path.resolve('rag-graphs');
const send = (res, status, value, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
const body = async req => { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 1e6) throw Error('Request too large'); } return raw ? JSON.parse(raw) : {}; };
const safeName = value => typeof value === 'string' && /^[a-z0-9_-]{1,69}$/i.test(value);

async function retrieve(chunks, query, corpus, options, k) {
  const lists = {};
  if (options.dense) lists.dense = await denseSearch(chunks, query, k);
  if (options.bm25) lists.bm25 = bm25Search(chunks, query, k);
  if (options.graph) {
    const file = path.join(graphs, `${corpus}.json`);
    if (!fs.existsSync(file)) throw Error(`Graph for ${corpus} not found. Build it using npm run rag:graph -- ${corpus}.`);
    const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
    const found = graphSearch(chunks, query, graph, k);
    lists.graph = found.hits;
  }
  return reciprocalRankFusion(lists, k);
}

async function route(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/rag' || url.pathname === '/rag-v4')) {
      return send(res, 200, fs.readFileSync(path.resolve('public/rag-v4.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/rag/v4/health') return send(res, 200, { version: 4, features: ['query-expansion', 'hybrid-retrieval', 'local-reranking', 'confidence-abstention', 'citation-validation'] });
    if (req.method === 'POST' && url.pathname === '/api/rag/v4/ask') {
      const p = await body(req);
      if (!safeName(p.corpus)) throw Error('A valid corpus name is required');
      if (typeof p.question !== 'string' || !p.question.trim() || p.question.length > 4000) throw Error('Question must contain 1–4000 characters');
      const chunking = { size: Number(p.size ?? 800), overlap: Number(p.overlap ?? 120) };
      const chunks = indexCorpus(path.join(root, p.corpus, 'docs'), chunking);
      const selected = Array.isArray(p.documents) && p.documents.length ? chunks.filter(c => p.documents.includes(c.source)) : chunks;
      const k = Math.min(30, Math.max(1, Number(p.candidate_k) || 15));
      const variants = p.expand === false ? [p.question.trim()] : expandQuery(p.question, { maxVariants: 3 });
      const options = { dense: p.dense !== false, bm25: p.bm25 !== false, graph: !!p.graph };
      if (!options.dense && !options.bm25 && !options.graph) throw Error('Enable at least one retriever');
      const lists = {};
      for (let i = 0; i < variants.length; i++) {
        const hits = await retrieve(selected, variants[i], p.corpus, options, k);
        lists[`query_${i + 1}`] = hits;
      }
      const fused = reciprocalRankFusion(lists, k);
      const ranked = rerankResults(p.question, fused, { limit: Math.min(20, Math.max(1, Number(p.k) || 5)), diversity: Number(p.diversity ?? 0.12) });
      const confidence = assessConfidence(p.question, ranked, { threshold: Number(p.threshold ?? 0.16) });
      let answer = null;
      if (p.generate) {
        if (!confidence.confident) {
          answer = { answer: 'I cannot answer reliably from the available documents. Please provide more specific details or add a relevant source.', citations: [], abstained: true };
        } else {
          const generated = await generateAnswer(p.question, ranked);
          answer = { ...validateCitations(generated, ranked.map(h => h.id)), abstained: false };
        }
      }
      return send(res, 200, {
        version: 4, query_variants: variants, retrievers: options,
        candidates: fused.length, retrieved: ranked, confidence, answer,
        answer_references: (answer?.citations || []).map(id => { const h = ranked.find(x => x.id === id); return { chunk_id: id, source: h?.source || null, rerank_score: h?.rerank_score ?? null }; })
      });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) { return send(res, 400, { error: error.message || 'Request failed' }); }
}

http.createServer(route).listen(process.env.RAG_PORT || 3100, () => console.log(`RAG V4: http://localhost:${process.env.RAG_PORT || 3100}/rag-v4`));
