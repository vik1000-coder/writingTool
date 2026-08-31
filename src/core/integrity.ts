import { parseLatex } from './latex';
import type { Artifact, ContextPacket, NumericClaim, ResolvedSuggestion, Suggestion } from './types';

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const OUTPUT_SCHEMA = object({
  mode: { type: 'string', enum: ['guide', 'write', 'evidence', 'visual', 'structure', 'chat'] }, title: string, text: string, insert_text: string,
  evidence_ids: strings, outline_ids: strings, citation_keys: strings,
  claims: { type: 'array', items: object({ value: string, artifact_id: string, source_hash: string, row: { type: ['integer', 'null'] }, column: { type: ['string', 'null'] } }) },
  proposal: { anyOf: [object({ type: { type: 'string', enum: ['figure', 'table', 'none'] }, purpose: string, placement: string, data_ids: strings, existing_artifact_ids: strings, panels: strings }), { type: 'null' }] },
  edit: { anyOf: [object({ path: string, original: string, replacement: string }), { type: 'null' }] },
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a structured object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 12000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized model text');
  return value;
}
function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid artifact list');
  return value.map(v => text(v, 1000));
}
export function validateSuggestion(value: unknown, mode: ContextPacket['mode']): Suggestion {
  const r = record(value);
  if (r.mode !== mode || !['guide', 'write', 'evidence', 'visual', 'structure', 'chat'].includes(mode)) throw new Error('Model response mode does not match request');
  const insert = text(r.insert_text, 600);
  if (mode !== 'write' && insert) throw new Error('Only WRITE can provide insertable prose');
  if (insert && (/\n\s*\n/.test(insert) || (insert.match(/[.!?](?:\s|$)/g)?.length ?? 0) > 2)) throw new Error('WRITE is limited to a clause or one to two sentences');
  if (!Array.isArray(r.claims) || r.claims.length > 30) throw new Error('Invalid numeric claims');
  const claims = r.claims.map(v => {
    const c = record(v);
    if (c.row !== null && (!Number.isInteger(c.row) || Number(c.row) < 1)) throw new Error('Invalid result row');
    return { value: text(c.value, 100), artifact_id: text(c.artifact_id, 1000), source_hash: text(c.source_hash, 100), row: c.row as number | null, column: c.column === null ? null : text(c.column, 500) };
  });
  let proposal: Suggestion['proposal'] = null;
  if (r.proposal != null) {
    const p = record(r.proposal);
    if (!['figure', 'table', 'none'].includes(String(p.type))) throw new Error('Invalid visualization type');
    proposal = { type: p.type as 'figure' | 'table' | 'none', purpose: text(p.purpose), placement: text(p.placement), data_ids: list(p.data_ids), existing_artifact_ids: list(p.existing_artifact_ids), panels: list(p.panels) };
  }
  let edit: Suggestion['edit'] = null;
  if (r.edit != null) {
    if (mode !== 'chat') throw new Error('Only explicit Chat can propose an edit');
    const e = record(r.edit); edit = { path: text(e.path, 1000), original: text(e.original), replacement: text(e.replacement) };
  }
  return { mode, title: text(r.title, 200), text: text(r.text), insert_text: insert, evidence_ids: list(r.evidence_ids), outline_ids: list(r.outline_ids), citation_keys: list(r.citation_keys), claims, proposal, edit };
}

export function numericTokens(value: string): string[] {
  const stripped = value.replace(/\\(?:[a-zA-Z]*cite[a-zA-Z]*|label|ref|eqref|autoref|cref|Cref)\*?(?:\[[^\]]*\])*\{[^}]*\}/g, '');
  return [...stripped.matchAll(/(?<![\p{L}\p{N}_])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?/gu)].map(m => m[0]);
}
const numericValue = (s: unknown) => typeof s === 'number' ? s : typeof s === 'string' && /^[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(s.trim()) ? Number(s.replaceAll(',', '')) : NaN;
function grounded(c: NumericClaim, artifacts: Map<string, Artifact>): boolean {
  const a = artifacts.get(c.artifact_id);
  if (!a || a.kind !== 'result' || c.source_hash !== a.hash || c.row === null || c.column === null || !a.locator.columns?.includes(c.column)) return false;
  const index = a.locator.rows?.indexOf(c.row) ?? -1;
  const rows = a.metadata.rows;
  if (index < 0 || !Array.isArray(rows) || !rows[index] || typeof rows[index] !== 'object') return false;
  const actual = numericValue(rows[index][c.column]);
  return Number.isFinite(actual) && actual === numericValue(c.value);
}
export function resolveSuggestion(suggestion: Suggestion, artifacts: Artifact[]): ResolvedSuggestion {
  const lookup = new Map(artifacts.map(a => [a.id, a]));
  const warnings: string[] = [];
  const ids = [...new Set([...suggestion.evidence_ids, ...suggestion.outline_ids, ...(suggestion.proposal?.data_ids ?? []), ...(suggestion.proposal?.existing_artifact_ids ?? [])])];
  const evidence = ids.flatMap(id => {
    const a = lookup.get(id);
    if (!a) { warnings.push(`Unknown or stale evidence: ${id}`); return []; }
    return [a];
  });
  const allProse = [suggestion.text, suggestion.insert_text, suggestion.edit?.replacement ?? '', suggestion.proposal?.purpose ?? '', ...(suggestion.proposal?.panels ?? [])].join('\n');
  const citeKeys = new Set([...suggestion.citation_keys, ...parseLatex('', allProse).citations.map(c => c.key)]);
  let invalidCitation = false;
  for (const key of citeKeys) {
    const bib = lookup.get(`bib:${key}`);
    if (!bib || bib.kind !== 'bib') { warnings.push(`Unknown citation key: ${key}`); invalidCitation = true; }
    else if (!artifacts.some(a => a.kind === 'pdf' && (a.metadata.citation_key === key || a.path === bib.metadata.pdf_path))) warnings.push(`${key}: Citation candidate — full-text evidence not verified.`);
  }
  const validClaims = suggestion.claims.filter(c => grounded(c, lookup));
  for (const c of suggestion.claims) if (!validClaims.includes(c)) warnings.push(`UNGROUNDED value ${c.value}: result locator is missing, mismatched, or stale.`);
  const grounding = [...new Set(numericTokens(allProse))].map(value => {
    const locator = validClaims.find(c => numericValue(c.value) === numericValue(value));
    if (!locator) warnings.push(`UNGROUNDED value ${value}: empirical value not verified against indexed results.`);
    return { value, status: locator ? 'GROUNDED' as const : 'UNGROUNDED' as const, ...(locator ? { locator } : {}) };
  });
  const insertedNumbers = numericTokens(suggestion.insert_text);
  const insertable = suggestion.mode === 'write' && Boolean(suggestion.insert_text) && !invalidCitation
    && !ids.some(id => !lookup.has(id)) && insertedNumbers.every(value => validClaims.some(c => numericValue(c.value) === numericValue(value)));
  return { suggestion, evidence, warnings: [...new Set(warnings)], insertable, grounding };
}

