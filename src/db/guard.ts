/**
 * Static check that LLM-written Cypher only reads. This is the first of two layers:
 * queries also run in READ transactions, so Neo4j itself rejects writes that slip past.
 */
const WRITE_CLAUSES =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|LOAD\s+CSV|ALTER|GRANT|DENY|REVOKE|TERMINATE|(?:START|STOP)\s+DATABASE)\b/i;
const USE_CLAUSE = /^\s*USE\b/i;
// CALL { ... } and CALL (x) { ... } are read-only subqueries; CALL some.procedure() may not be.
const PROCEDURE_CALL = /\bCALL\s+(?![({])/i;

export type GuardResult = { ok: true; cypher: string } | { ok: false; reason: string };

/** Removes string literals and comments, so `WHERE d.name = "Set Point"` doesn't trip the check. */
function code(cypher: string): string {
  return cypher
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g, '""')
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
}

export function checkReadOnly(raw: string): GuardResult {
  const cypher = raw
    .trim()
    .replace(/^```(?:cypher)?\s*|```$/g, '')
    .trim()
    .replace(/;+\s*$/, '');
  if (!cypher) return { ok: false, reason: 'The query is empty.' };

  const stripped = code(cypher);
  if (stripped.includes(';')) return { ok: false, reason: 'Only one statement is allowed.' };
  const write = WRITE_CLAUSES.exec(stripped);
  if (write) return { ok: false, reason: `Write or admin clause "${write[1]!.toUpperCase()}" is not allowed; queries are read-only.` };
  if (USE_CLAUSE.test(stripped)) return { ok: false, reason: 'Switching databases is not allowed.' };
  if (PROCEDURE_CALL.test(stripped)) return { ok: false, reason: 'Procedure calls are not allowed; use plain MATCH queries.' };
  if (!/\bRETURN\b/i.test(stripped)) return { ok: false, reason: 'The query must RETURN something.' };
  return { ok: true, cypher };
}
