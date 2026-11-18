import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { indexCorpus, loadQuestions, generateAnswer } from '../server/rag-core.js';
import { bm25Search, denseSearch, graphSearch, reciprocalRankFusion } from '../server/rag-v3-core.js';

const corpus = process.argv[2] || 'kestrel';
const base = process.env.RAG_LOCAL_URL || `http://localhost:${process.env.RAG_PORT || 3100}`;
const requested = process.argv.find(x => x.startsWith('--retrievers='))?.split('=')[1];
const configurations = requested ? [requested.split(',').sort().join('+')] : undefined;
const generate = process.argv.includes('--generate');

const root = path.resolve('rag-data');
const out = path.resolve('rag-results');
const graphs = path.resolve('rag-graphs');
fs.mkdirSync(out, { recursive: true });

async function runLists(chunks, question, corpusName, enabled, k, chunking = { size: 800, overlap: 120 }) {
  const lists = {}, meta = { entities: [], paths: [] };
  if (enabled.dense) lists.dense = await denseSearch(chunks, question, k);
  if (enabled.bm25) lists.bm25 = bm25Search(chunks, question, k);
  if (enabled.graph) {
    const graphPath = path.join(graphs, `${corpusName}.json`);
    if (!fs.existsSync(graphPath)) {
      throw Error(`Graph for corpus "${corpusName}" is missing. Run npm run rag:graph -- ${corpusName} first.`);
    }
    const g = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const r = graphSearch(chunks, question, g, k);
    lists.graph = r.hits;
    meta.entities = r.entities;
    meta.paths = r.paths;
  }
  return { lists, hits: reciprocalRankFusion(lists, k), meta };
}

async function evaluateLocally() {
  const opts = { size: 800, overlap: 120, k: 5 };
  const chunks = indexCorpus(path.join(root, corpus, 'docs'), opts);
  const questions = loadQuestions(path.join(root, corpus, 'questions.jsonl'));

  const defaults = [
    { name: 'dense', enabled: { dense: true, bm25: false, graph: false } },
    { name: 'dense+bm25', enabled: { dense: true, bm25: true, graph: false } }
  ];
  if (corpus === 'kestrel') {
    defaults.push({ name: 'dense+bm25+graph', enabled: { dense: true, bm25: true, graph: true } });
  }

  const configs = configurations
    ? configurations.map(c => ({
        name: c,
        enabled: {
          dense: c === 'dense' || c.includes('dense'),
          bm25: c.includes('bm25'),
          graph: c.includes('graph')
        }
      }))
    : defaults;

  const results = [];
  for (const config of configs) {
    const rows = [];
    for (const q of questions) {
      const t = Date.now();
      try {
        const { lists, hits, meta } = await runLists(chunks, q.question, corpus, config.enabled, 10, opts);
        const relevant = chunks.filter(c =>
          (q.evidence || []).some(e => {
            const src = (e.source || e.document || '').split('/').pop();
            return src === c.source.split('/').pop() && (!e.quote || c.text.includes(e.quote));
          })
        );
        const ranks = [1, 3, 5, 10].map(k => {
          const found = hits.slice(0, k).filter(h => relevant.some(r => r.id === h.id));
          return { k, hit: found.length ? 1 : 0, recall: relevant.length ? found.length / relevant.length : null };
        });

        let generated = null;
        if (generate) {
          try {
            generated = await generateAnswer(q.question, hits.slice(0, opts.k));
          } catch (err) {
            generated = { error: err.message };
          }
        }

        rows.push({
          id: q.id,
          question: q.question,
          type: q.type,
          answerable: q.answerable,
          evidence: q.evidence,
          relevant_chunk_ids: relevant.map(c => c.id),
          retrieved: hits,
          ranks,
          lists: config.enabled,
          graph_path: meta.paths,
          graph_entities: meta.entities,
          generated,
          cost: {
            llm_calls: (config.enabled.dense ? 1 : 0) + (generated && !generated.error ? 1 : 0),
            tokens: (lists.dense?.[0]?.embedding_usage?.total_tokens ?? 0) + (generated?.usage?.total_tokens ?? 0) || null,
            latency_ms: Date.now() - t
          }
        });
      } catch (e) {
        rows.push({
          id: q.id,
          question: q.question,
          type: q.type,
          error: e.message,
          retrieved: [],
          ranks: [],
          cost: { llm_calls: 0, tokens: null, latency_ms: Date.now() - t }
        });
      }
    }

    const eligible = rows.filter(r => r.answerable && r.relevant_chunk_ids?.length);
    const metricSet = rs =>
      Object.fromEntries(
        [1, 3, 5, 10].flatMap(k => {
          const rr = rs.filter(r => r.ranks?.length);
          return [
            [`hit_rate_at_${k}`, rr.length ? rr.reduce((s, r) => s + r.ranks.find(x => x.k === k).hit, 0) / rr.length : null],
            [`recall_at_${k}`, rr.length ? rr.reduce((s, r) => s + (r.ranks.find(x => x.k === k).recall || 0), 0) / rr.length : null]
          ];
        })
      );

    results.push({
      configuration: config.name,
      corpus,
      summary: {
        questions: rows.length,
        answerable: rows.filter(r => r.answerable).length,
        excluded_unanswerable: rows.filter(r => !r.answerable).length,
        missing_ground_truth: rows.filter(r => r.answerable && !r.relevant_chunk_ids?.length).length,
        ...metricSet(eligible)
      },
      by_type: Object.fromEntries(
        [...new Set(rows.filter(r => r.answerable).map(r => r.type))].map(type => [
          type,
          {
            count: rows.filter(r => r.answerable && r.type === type).length,
            ...metricSet(rows.filter(r => r.answerable && r.type === type && r.relevant_chunk_ids?.length))
          }
        ])
      ),
      rows
    });
  }

  const file = `v3-${corpus}-${Date.now()}.json`;
  const output = {
    version: 3,
    corpus,
    config: opts,
    generated: !!generate,
    results
  };
  fs.writeFileSync(path.join(out, file), JSON.stringify(output, null, 2));
  return { file: path.join('rag-results', file), ...output };
}

try {
  let j;
  try {
    const r = await fetch(`${base}/api/rag/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpus, size: 800, overlap: 120, k: 5, generate, configurations })
    });
    if (r.ok) {
      j = await r.json();
    }
  } catch {
    // If server is not running on port 3100, execute in-process evaluation directly
    j = await evaluateLocally();
  }

  if (!j) j = await evaluateLocally();
  console.log(`Saved ${j.file}`);
  for (const x of j.results || []) {
    console.log(`\n--- Configuration: ${x.configuration} (${x.corpus}) ---`);
    console.log(`HitRate@1: ${(x.summary.hit_rate_at_1*100).toFixed(1)}% | HitRate@3: ${(x.summary.hit_rate_at_3*100).toFixed(1)}% | HitRate@5: ${(x.summary.hit_rate_at_5*100).toFixed(1)}% | HitRate@10: ${(x.summary.hit_rate_at_10*100).toFixed(1)}%`);
    console.log(`Recall@1:  ${(x.summary.recall_at_1*100).toFixed(1)}% | Recall@3:  ${(x.summary.recall_at_3*100).toFixed(1)}% | Recall@5:  ${(x.summary.recall_at_5*100).toFixed(1)}% | Recall@10:  ${(x.summary.recall_at_10*100).toFixed(1)}%`);
    console.log('Breakdown by question type:');
    for (const [t, m] of Object.entries(x.by_type || {})) {
      console.log(`  [${t}] (n=${m.count}): Hit@5 = ${(m.hit_rate_at_5*100).toFixed(1)}%, Recall@5 = ${(m.recall_at_5*100).toFixed(1)}%`);
    }
  }
} catch (e) {
  console.error(`V3 evaluation failed: ${e.message}`);
  process.exit(1);
}
