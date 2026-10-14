import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraphData, type Tables } from '../src/data/transform.ts';

// A two-race season: round 1 has results, round 2 is scheduled but not raced yet.
const tables: Tables = {
  formula_one_season: [{ id: '1', year: '2026' }],
  formula_one_circuit: [
    { id: '10', reference: 'monaco', name: 'Circuit de Monaco', locality: 'Monte-Carlo', country: 'Monaco' },
    { id: '11', reference: 'monza', name: 'Monza', locality: 'Monza', country: 'Italy' },
  ],
  formula_one_driver: [
    { id: '100', reference: 'leclerc', forename: 'Charles', surname: 'Leclerc', abbreviation: 'LEC', permanent_car_number: '16', nationality: 'Monegasque', date_of_birth: '1997-10-16' },
    { id: '101', reference: 'hamilton', forename: 'Lewis', surname: 'Hamilton', abbreviation: 'HAM', permanent_car_number: '44', nationality: 'British', date_of_birth: '1985-01-07' },
    { id: '102', reference: 'unused', forename: 'Never', surname: 'Raced', abbreviation: '', permanent_car_number: '', nationality: '', date_of_birth: '' },
  ],
  formula_one_team: [{ id: '200', reference: 'ferrari', name: 'Ferrari', nationality: 'Italian' }],
  formula_one_round: [
    { id: '300', season_id: '1', circuit_id: '10', number: '1', name: 'Monaco Grand Prix', date: '2026-05-24', is_cancelled: 'f' },
    { id: '301', season_id: '1', circuit_id: '11', number: '2', name: 'Italian Grand Prix', date: '2026-09-06', is_cancelled: 'f' },
  ],
  formula_one_teamdriver: [
    { id: '400', driver_id: '100', team_id: '200', season_id: '1' },
    { id: '401', driver_id: '101', team_id: '200', season_id: '1' },
  ],
  formula_one_roundentry: [
    { id: '500', round_id: '300', team_driver_id: '400' },
    { id: '501', round_id: '300', team_driver_id: '401' },
  ],
  formula_one_session: [
    { id: '600', round_id: '300', type: 'R', is_cancelled: 'f' },
    { id: '601', round_id: '300', type: 'Q3', is_cancelled: 'f' },
  ],
  formula_one_sessionentry: [
    { session_id: '600', round_entry_id: '500', position: '1', grid: '1', points: '25', laps_completed: '78', detail: 'Finished', is_classified: 't', fastest_lap_rank: '1', time: '1:40:00' },
    { session_id: '600', round_entry_id: '501', position: '20', grid: '0', points: '0', laps_completed: '12', detail: 'Engine', is_classified: 'f', fastest_lap_rank: '', time: '' },
    { session_id: '601', round_entry_id: '500', position: '1', grid: '', points: '0', laps_completed: '', detail: '', is_classified: 't', fastest_lap_rank: '', time: '' },
  ],
  formula_one_driverchampionship: [
    { driver_id: '101', year: '2026', round_number: '1', session_number: '4', position: '1', points: '1', win_count: '0' },
    { driver_id: '100', year: '2026', round_number: '1', session_number: '5', position: '1', points: '25', win_count: '1' },
    { driver_id: '101', year: '2026', round_number: '1', session_number: '5', position: '2', points: '0', win_count: '0' },
  ],
  formula_one_teamchampionship: [{ team_id: '200', year: '2026', round_number: '1', session_number: '5', position: '1', points: '25', win_count: '1' }],
};

describe('buildGraphData', () => {
  const data = buildGraphData(tables);

  it('keeps only Grand Prix race results', () => {
    assert.equal(data.results.length, 2);
    assert.deepEqual(data.results[0], {
      raceId: '2026-1',
      driverId: 'leclerc',
      teamId: 'ferrari',
      position: 1,
      grid: 1,
      points: 25,
      laps: 78,
      status: 'Finished',
      classified: true,
      fastestLap: true,
      time: '1:40:00',
    });
    assert.equal(data.results[1]!.classified, false);
    assert.equal(data.results[1]!.time, null);
  });

  it('creates races only for rounds with results, and marks the season incomplete', () => {
    assert.deepEqual(data.races.map((race) => race.id), ['2026-1']);
    assert.deepEqual(data.seasons, [{ year: 2026, complete: false }]);
    assert.deepEqual(data.circuits.map((circuit) => circuit.id), ['monaco']);
  });

  it('drops drivers who never raced and maps empty values to null', () => {
    assert.deepEqual(data.drivers.map((driver) => driver.id), ['leclerc', 'hamilton']);
    assert.equal(data.drivers[0]!.name, 'Charles Leclerc');
    assert.equal(data.drivers[0]!.number, 16);
  });

  it('uses the last standings row of the season as the final standings', () => {
    assert.deepEqual(data.driverStandings, [
      { driverId: 'leclerc', year: 2026, position: 1, points: 25, wins: 1 },
      { driverId: 'hamilton', year: 2026, position: 2, points: 0, wins: 0 },
    ]);
    assert.equal(data.teamStandings[0]!.teamId, 'ferrari');
  });

  it('fails clearly when a table is missing', () => {
    const { formula_one_round: _, ...broken } = tables;
    assert.throws(() => buildGraphData(broken), /Missing table formula_one_round/);
  });
});
