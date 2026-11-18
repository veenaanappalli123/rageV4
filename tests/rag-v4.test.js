import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery, rerankResults, assessConfidence, validateCitations } from '../server/rag-v4-core.js';

test('query expansion preserves the original query and adds relevant alternatives', () => {
  const variants = expandQuery('login failure for KST-5031');
  assert.equal(variants[0], 'login failure for KST-5031');
  assert.ok(variants.some(x => x.includes('sign in')));
  assert.ok(variants.length <= 3);
});

test('query expansion validates empty input and variant bounds', () => {
  assert.throws(() => expandQuery(' '), /required/);
  assert.throws(() => expandQuery('login', { maxVariants: 0 }), /maxVariants/);
});

test('reranker promotes exact identifiers and returns stable scored results', () => {
  const hits = [
    { id: 'generic', source: 'a.md', text: 'Authentication is used by the service.', score: 0.01 },
    { id: 'exact', source: 'b.md', text: 'KST-5031 is a critical scheduled report failure.', score: 0.005 }
  ];
  const ranked = rerankResults('What does KST-5031 mean?', hits, { limit: 2 });
  assert.equal(ranked[0].id, 'exact');
  assert.ok(ranked[0].rerank_score > ranked[1].rerank_score);
});

test('reranker applies diversity penalty to repeated sources', () => {
  const hits = [1,2,3].map(n => ({ id: `c${n}`, source: n < 3 ? 'same.md' : 'other.md', text: `login authentication issue ${n}`, score: 0.02 }));
  const ranked = rerankResults('login issue', hits, { limit: 3, diversity: 1 });
  assert.equal(ranked[0].source, 'same.md');
  assert.equal(ranked[1].source, 'other.md');
});

test('confidence assessment abstains below threshold', () => {
  const low = assessConfidence('unknown question', [{ rerank_score: 0.04 }], { threshold: 0.2 });
  assert.equal(low.confident, false);
  assert.equal(low.reason.includes('minimum relevance'), true);
  const high = assessConfidence('known question', [{ rerank_score: 0.8 }, { rerank_score: 0.2 }]);
  assert.equal(high.confident, true);
});

test('citation validation removes IDs outside retrieved evidence', () => {
  const result = validateCitations({ answer: 'Grounded answer', citations: ['c1', 'fake', 'c1'] }, ['c1', 'c2']);
  assert.deepEqual(result.citations, ['c1']);
  assert.deepEqual(result.rejected_citations, ['fake']);
});
