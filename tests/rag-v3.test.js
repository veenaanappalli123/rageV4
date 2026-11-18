import test from 'node:test';
import assert from 'node:assert/strict';
import { bm25Search, denseSearch, reciprocalRankFusion, graphSearch, extractionSchema } from '../server/rag-v3-core.js';

const chunks = [
  { id: 'a', source: 'a.md', text: 'KST-5031 scheduled report failure is sent by postroom.' },
  { id: 'b', source: 'b.md', text: 'Messaging team owns postroom and uses #oncall-messaging.' },
  { id: 'c', source: 'c.md', text: 'Billing invoices and customer payment refunds.' }
];

test('BM25 ranks exact identifiers and relevant terms', () => {
  const r = bm25Search(chunks, 'KST-5031', 2);
  assert.equal(r[0].id, 'a');
  assert.ok(r[0].score > 0);
  assert.deepEqual(r[0].retrievers, ['bm25']);
});

test('Dense retrieval returns scored chunks with embeddings metadata', async () => {
  const r = await denseSearch(chunks, 'customer payment invoices', 2);
  assert.ok(r.length > 0);
  assert.equal(r[0].id, 'c');
  assert.ok(typeof r[0].score === 'number');
  assert.deepEqual(r[0].retrievers, ['dense']);
});

test('RRF merges lists and preserves rank provenance', () => {
  const r = reciprocalRankFusion({
    dense: [{ ...chunks[0], score: 0.9 }, { ...chunks[1], score: 0.5 }],
    bm25: [{ ...chunks[1], score: 4 }, { ...chunks[0], score: 2 }]
  }, 2);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].retrievers.sort(), ['bm25', 'dense']);
  assert.equal(r[0].ranks.dense, 1);
});

test('Weighted RRF prioritizes higher-weighted retriever', () => {
  const listDense = [{ ...chunks[0], score: 0.9 }, { ...chunks[1], score: 0.5 }];
  const listBm25 = [{ ...chunks[1], score: 4.0 }, { ...chunks[0], score: 2.0 }];
  const r = reciprocalRankFusion({ dense: listDense, bm25: listBm25 }, 2, 60, { dense: 10.0, bm25: 1.0 });
  assert.equal(r[0].id, 'a'); // Heavily weighted dense rank 1 wins
});

test('Graph retrieval returns provenance and a two-hop path', () => {
  const graph = {
    nodes: [
      { id: 'kst_5031', name: 'KST-5031', type: 'error_code' },
      { id: 'postroom', name: 'postroom', type: 'service' },
      { id: 'messaging', name: 'Messaging', type: 'team' }
    ],
    edges: [
      { id: '1', source: 'kst_5031', relation: 'routes_to', target: 'postroom', chunk_ids: ['a'] },
      { id: '2', source: 'postroom', relation: 'owned_by', target: 'messaging', chunk_ids: ['b'] }
    ]
  };
  const r = graphSearch(chunks, 'KST-5031 scheduled report', graph, 5);
  assert.deepEqual(r.hits.map(x => x.id).sort(), ['a', 'b']);
  assert.ok(r.paths.length >= 2);
  assert.ok(r.entities.some(e => e.id === 'kst_5031'));
});

test('Zod extractionSchema rejects invalid entity and relation types', () => {
  const valid = {
    triples: [
      { subject: 'postroom', subject_type: 'service', relation: 'owned_by', object: 'Messaging', object_type: 'team', evidence: 'Messaging owns postroom' }
    ]
  };
  assert.doesNotThrow(() => extractionSchema.parse(valid));

  const invalid = {
    triples: [
      { subject: 'unknown', subject_type: 'alien_type', relation: 'owned_by', object: 'team', object_type: 'team', evidence: 'quote' }
    ]
  };
  assert.throws(() => extractionSchema.parse(invalid));
});
