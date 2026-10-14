/**
 * Execution accuracy: does the generated query return the same answer as the reference?
 * Column names and order don't matter, and extra columns are fine ("driver, wins, team"
 * still answers "who won most"). Every reference row must be found in a different row
 * of the generated result, and the generated result may not be much longer than needed.
 */
type Rows = Array<Record<string, unknown>>;

/** Lists of reference rows this short may be answered inside a top-10 list. */
const EXTRA_ROWS_ALLOWED = 10;

export function normalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Numbers sometimes come back as strings; "423" and 423.0 are the same answer.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return normalize(Number(trimmed));
    return trimmed.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }
  if (Array.isArray(value)) return `[${value.map(normalize).sort().join(',')}]`;
  return JSON.stringify(value);
}

const values = (row: Record<string, unknown>) => Object.values(row).map(normalize);

export function sameAnswer(reference: Rows, generated: Rows): boolean {
  if (reference.length === 0) return generated.length === 0;
  if (generated.length > Math.max(reference.length, EXTRA_ROWS_ALLOWED)) return false;

  const unused = generated.map(values);
  for (const row of reference.map(values)) {
    const index = unused.findIndex((candidate) => row.every((value) => candidate.includes(value)));
    if (index === -1) return false;
    unused.splice(index, 1);
  }
  return true;
}
