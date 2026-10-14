import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkReadOnly } from '../src/db/guard.ts';

const rejected = (cypher: string) => {
  const result = checkReadOnly(cypher);
  return result.ok ? null : result.reason;
};

describe('checkReadOnly', () => {
  it('accepts read queries, including CALL subqueries', () => {
    for (const cypher of [
      'MATCH (d:Driver) RETURN d.name LIMIT 5',
      'MATCH (d:Driver) CALL (d) { MATCH (d)-[:HAS_RESULT]->(r) RETURN count(r) AS n } RETURN d.name, n',
      'MATCH (r:Race) WITH r.year AS start RETURN start',
    ]) {
      assert.equal(rejected(cypher), null, cypher);
    }
  });

  it('strips markdown fences and a trailing semicolon', () => {
    const result = checkReadOnly('```cypher\nMATCH (n) RETURN n;\n```');
    assert.deepEqual(result, { ok: true, cypher: 'MATCH (n) RETURN n' });
  });

  it('rejects writes, admin commands and procedures', () => {
    assert.match(rejected('MATCH (d:Driver) DETACH DELETE d RETURN 1')!, /DETACH/);
    assert.match(rejected('MERGE (d:Driver {id: "x"}) RETURN d')!, /MERGE/);
    assert.match(rejected('MATCH (d) SET d.name = "x" RETURN d')!, /SET/);
    assert.match(rejected('LOAD CSV FROM "http://x" AS row RETURN row')!, /LOAD CSV/);
    assert.match(rejected('CALL dbms.components() YIELD name RETURN name')!, /Procedure/);
    assert.match(rejected('STOP DATABASE neo4j')!, /STOP DATABASE/);
    assert.match(rejected('USE system MATCH (n) RETURN n')!, /databases/);
  });

  it('rejects multiple statements', () => {
    assert.match(rejected('MATCH (n) RETURN n; MATCH (m) DETACH DELETE m')!, /one statement|DETACH/);
  });

  it('ignores keywords inside strings and comments', () => {
    assert.equal(rejected('MATCH (r:Result {status: "Set off"}) RETURN r // delete later'), null);
    assert.equal(rejected("MATCH (t:Team) WHERE t.name = 'Merge; Racing' RETURN t"), null);
  });

  it('requires a RETURN', () => {
    assert.match(rejected('MATCH (n)')!, /RETURN/);
  });
});
