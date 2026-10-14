import neo4j, { type Driver, isDate, isNode, isRelationship } from 'neo4j-driver';
import type { Config } from '../config.ts';

export type QueryResult = { columns: string[]; rows: Array<Record<string, unknown>>; truncated: boolean };

/** What the agent needs from the database; tests use an in-memory fake. */
export interface QueryRunner {
  run(cypher: string): Promise<QueryResult>;
  /** Date of the most recent race in the data, for "as of" statements. */
  dataUntil(): Promise<string>;
}

const MAX_ROWS = 100;
const TIMEOUT_MS = 5_000;

/** Neo4j values -> plain JSON: dates to ISO strings, nodes to their properties. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(plain);
  if (isDate(value as object)) return value!.toString();
  if (isNode(value as object) || isRelationship(value as object)) {
    return plain((value as { properties: unknown }).properties);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as object).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

export class Neo4jRunner implements QueryRunner {
  readonly #driver: Driver;

  constructor(config: Config['neo4j']) {
    this.#driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
      // Counts and years fit comfortably in JS numbers.
      disableLosslessIntegers: true,
    });
  }

  async run(cypher: string): Promise<QueryResult> {
    const session = this.#driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.executeRead((tx) => tx.run(cypher), { timeout: TIMEOUT_MS });
      const rows = result.records.slice(0, MAX_ROWS).map((record) => plain(record.toObject()) as Record<string, unknown>);
      return { columns: result.records[0]?.keys.map(String) ?? [], rows, truncated: result.records.length > MAX_ROWS };
    } finally {
      await session.close();
    }
  }

  async dataUntil(): Promise<string> {
    const { rows } = await this.run('MATCH (r:Race) RETURN max(r.date) AS last');
    return String(rows[0]?.last ?? 'unknown');
  }

  close(): Promise<void> {
    return this.#driver.close();
  }
}
