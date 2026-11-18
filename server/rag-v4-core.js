import { tokenize } from './rag-core.js';

const SYNONYMS = new Map([
  ['login', ['sign in', 'authentication']], ['signin', ['login', 'authentication']],
  ['auth', ['authentication', 'login']], ['error', ['failure', 'exception']],
  ['slow', ['latency', 'performance']], ['down', ['unavailable', 'outage']],
  ['invoice', ['billing', 'charge']], ['refund', ['reimbursement', 'billing']],
  ['api', ['endpoint', 'service']], ['timeout', ['latency', 'connection']],
  ['crash', ['failure', 'exception']], ['permission', ['access', 'authorization']]
]);

// Expand terms without discarding the user's exact wording or identifiers.
export function expandQuery(question, { maxVariants = 3 } = {}) {
  if (typeof question !== 'string' || !question.trim()) throw Error('Question is required');
  if (!Number.isInteger(maxVariants) || maxVariants < 1 || maxVariants > 8) throw Error('maxVariants must be between 1 and 8');
  const terms = tokenize(question);
  const variants = [question.trim()];
  for (const term of terms) {
    const alternatives = SYNONYMS.get(term);
    if (!alternatives) continue;
    for (const alternative of alternatives) {
      const candidate = `${question.trim()} ${alternative}`;
      if (!variants.includes(candidate)) variants.push(candidate);
      if (variants.length >= maxVariants) return variants;
    }
  }
  return variants;
}

function overlapScore(queryTerms, textTerms) {
  if (!queryTerms.length) return 0;
  const doc = new Set(textTerms);
  return queryTerms.filter(t => doc.has(t)).length / new Set(queryTerms).size;
}

function phraseScore(question, text) {
  const q = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 1;
  const identifiers = question.match(/[A-Z]{2,}[\-_]?\d+[A-Z\d\-_]*/g) || [];
  return identifiers.length && identifiers.some(id => text.toLowerCase().includes(id.toLowerCase())) ? 1 : 0;
}

// A transparent, local second-stage reranker. No extra model/API call is needed.
export function rerankResults(question, candidates, { limit = 5, diversity = 0.12 } = {}) {
  if (!Array.isArray(candidates)) throw Error('Candidates must be an array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error('limit must be between 1 and 50');
  if (typeof diversity !== 'number' || diversity < 0 || diversity > 1) throw Error('diversity must be between 0 and 1');
  const qTerms = tokenize(question);
  const scored = candidates.map(hit => {
    const text = String(hit.text || '');
    const lexical = overlapScore(qTerms, tokenize(text));
    const phrase = phraseScore(question, text);
    const fusion = Number(hit.score || 0);
    const graph = hit.graph_path?.length ? 1 : 0;
    const normalizedFusion = fusion / (fusion + 0.01);
    const relevance = 0.58 * lexical + 0.18 * phrase + 0.18 * normalizedFusion + 0.06 * graph;
    return { ...hit, rerank_score: Number(relevance.toFixed(6)), rerank_features: { lexical, exact_phrase_or_identifier: phrase, fusion: normalizedFusion, graph_provenance: graph } };
  });
  // Greedy MMR-like selection penalizes near-duplicate chunks from the same source.
  const selected = [];
  const remaining = [...scored];
  while (remaining.length && selected.length < limit) {
    remaining.sort((a, b) => {
      const adjusted = item => item.rerank_score - diversity * (selected.some(s => s.source === item.source) ? 0.35 : 0);
      return adjusted(b) - adjusted(a) || a.id.localeCompare(b.id);
    });
    selected.push(remaining.shift());
  }
  return selected;
}

export function assessConfidence(question, ranked, { threshold = 0.16 } = {}) {
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) throw Error('threshold must be between 0 and 1');
  const top = ranked[0];
  const score = top?.rerank_score || 0;
  const second = ranked[1]?.rerank_score || 0;
  const margin = Math.max(0, score - second);
  const confident = score >= threshold;
  return {
    confident,
    score: Number(score.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    threshold,
    reason: confident ? 'Relevant source evidence was retrieved.' : 'Retrieved evidence did not meet the minimum relevance threshold.'
  };
}

export function validateCitations(answer, allowedChunkIds) {
  if (!answer || typeof answer.answer !== 'string' || !Array.isArray(answer.citations)) throw Error('Invalid answer object');
  const allowed = new Set(allowedChunkIds);
  const citations = [...new Set(answer.citations.filter(id => allowed.has(id)))];
  const unsupported = answer.citations.filter(id => !allowed.has(id));
  return { ...answer, citations, rejected_citations: unsupported };
}
