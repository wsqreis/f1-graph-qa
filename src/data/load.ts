import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Driver } from 'neo4j-driver';
import type { GraphData, Tables } from './transform.ts';

export async function readTables(dir: string): Promise<Tables> {
  const tables: Tables = {};
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.csv')) continue;
    tables[file.replace(/\.csv$/, '')] = parse(await readFile(join(dir, file)), { columns: true, skip_empty_lines: true });
  }
  return tables;
}

const BATCH = 2000;

const SCHEMA = [
  'CREATE CONSTRAINT driver_id IF NOT EXISTS FOR (n:Driver) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT team_id IF NOT EXISTS FOR (n:Team) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT circuit_id IF NOT EXISTS FOR (n:Circuit) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT race_id IF NOT EXISTS FOR (n:Race) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT season_year IF NOT EXISTS FOR (n:Season) REQUIRE n.year IS UNIQUE',
  'CREATE INDEX driver_name IF NOT EXISTS FOR (n:Driver) ON (n.name)',
  'CREATE INDEX driver_surname IF NOT EXISTS FOR (n:Driver) ON (n.surname)',
  'CREATE INDEX team_name IF NOT EXISTS FOR (n:Team) ON (n.name)',
  'CREATE INDEX race_year IF NOT EXISTS FOR (n:Race) ON (n.year)',
  'CREATE INDEX result_position IF NOT EXISTS FOR (n:Result) ON (n.position)',
];

// JavaScript numbers reach Neo4j as floats, so integer fields are converted with toInteger().
const WRITES: Array<[keyof GraphData, string]> = [
  ['seasons', 'UNWIND $rows AS row MERGE (s:Season {year: toInteger(row.year)}) SET s.complete = row.complete'],
  ['circuits', 'UNWIND $rows AS row MERGE (c:Circuit {id: row.id}) SET c += row'],
  ['drivers', 'UNWIND $rows AS row MERGE (d:Driver {id: row.id}) SET d += row, d.number = toInteger(row.number)'],
  ['teams', 'UNWIND $rows AS row MERGE (t:Team {id: row.id}) SET t += row'],
  [
    'races',
    `UNWIND $rows AS row
     MATCH (c:Circuit {id: row.circuitId}), (s:Season {year: toInteger(row.year)})
     MERGE (r:Race {id: row.id})
     SET r.year = toInteger(row.year), r.round = toInteger(row.round), r.name = row.name, r.date = date(row.date)
     MERGE (r)-[:AT_CIRCUIT]->(c)
     MERGE (r)-[:IN_SEASON]->(s)`,
  ],
  [
    'results',
    `UNWIND $rows AS row
     MATCH (d:Driver {id: row.driverId}), (t:Team {id: row.teamId}), (r:Race {id: row.raceId})
     CREATE (res:Result {position: toInteger(row.position), grid: toInteger(row.grid), points: toFloat(row.points), laps: toInteger(row.laps),
                         status: row.status, classified: row.classified, fastestLap: row.fastestLap, time: row.time})
     CREATE (d)-[:HAS_RESULT]->(res)-[:IN_RACE]->(r)
     CREATE (res)-[:FOR_TEAM]->(t)`,
  ],
  [
    'driverStandings',
    `UNWIND $rows AS row
     MATCH (d:Driver {id: row.driverId}), (s:Season {year: toInteger(row.year)})
     MERGE (d)-[f:FINISHED_SEASON]->(s)
     SET f.position = toInteger(row.position), f.points = toFloat(row.points), f.wins = toInteger(row.wins)`,
  ],
  [
    'teamStandings',
    `UNWIND $rows AS row
     MATCH (t:Team {id: row.teamId}), (s:Season {year: toInteger(row.year)})
     MERGE (t)-[f:FINISHED_SEASON]->(s)
     SET f.position = toInteger(row.position), f.points = toFloat(row.points), f.wins = toInteger(row.wins)`,
  ],
];

/** Replaces the database contents with `data`. Results have no natural key, so a reload starts clean. */
export async function writeGraph(driver: Driver, data: GraphData, log: (line: string) => void = console.log) {
  const session = driver.session();
  try {
    log('Clearing the database...');
    await session.run('MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS');
    for (const statement of SCHEMA) await session.run(statement);

    for (const [key, cypher] of WRITES) {
      const rows = data[key] as unknown[];
      for (let start = 0; start < rows.length; start += BATCH) {
        await session.executeWrite((tx) => tx.run(cypher, { rows: rows.slice(start, start + BATCH) }));
      }
      log(`  ${key.padEnd(16)} ${rows.length}`);
    }
  } finally {
    await session.close();
  }
}
