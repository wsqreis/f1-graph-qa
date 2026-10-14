// Runs against the Neo4j from compose.yaml with the data loaded; skipped when it is not reachable.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { Neo4jRunner } from '../src/db/runner.ts';

const db = new Neo4jRunner(loadConfig().neo4j);
let available = false;
before(async () => {
  try {
    available = (await db.dataUntil()) !== 'null';
  } catch {
    available = false;
  }
});
after(() => db.close());

describe('Neo4j integration', () => {
  it('returns plain JSON values: numbers, ISO dates, no driver objects', async (t) => {
    if (!available) return t.skip('Neo4j not reachable or empty');
    const { rows } = await db.run('MATCH (r:Race {id: "2021-22"}) RETURN r.year AS year, r.date AS date, r AS race');
    assert.equal(rows[0]?.year, 2021);
    assert.equal(rows[0]?.date, '2021-12-12');
    assert.equal((rows[0]?.race as { name: string }).name, 'Abu Dhabi Grand Prix');
  });

  it('refuses writes at the database level even without the static guard', async (t) => {
    if (!available) return t.skip('Neo4j not reachable or empty');
    await assert.rejects(db.run('CREATE (x:Probe) RETURN x'), /write|read/i);
  });

  it('every eval reference query runs and returns rows', async (t) => {
    if (!available) return t.skip('Neo4j not reachable or empty');
    const cases: Array<{ id: string; reference: string | null }> = JSON.parse(
      await readFile(new URL('../eval/cases.json', import.meta.url), 'utf8'),
    );
    for (const { id, reference } of cases) {
      if (!reference) continue;
      const { rows } = await db.run(reference);
      assert.ok(rows.length > 0, `${id} returned no rows`);
    }
  });
});
