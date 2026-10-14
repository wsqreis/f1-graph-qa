// Loads data/raw (see scripts/download.ts) into Neo4j, replacing what is there.
import neo4j from 'neo4j-driver';
import { loadConfig } from '../src/config.ts';
import { readTables, writeGraph } from '../src/data/load.ts';
import { buildGraphData } from '../src/data/transform.ts';

const { neo4j: db } = loadConfig();
const started = performance.now();

const data = buildGraphData(await readTables(new URL('../data/raw/', import.meta.url).pathname));
const driver = neo4j.driver(db.uri, neo4j.auth.basic(db.user, db.password));
try {
  await driver.verifyConnectivity();
  console.log(`Loading into ${db.uri}`);
  await writeGraph(driver, data);
  console.log(`Done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await driver.close();
}
