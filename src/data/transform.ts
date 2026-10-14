// Turns the relational Jolpica F1 dump into the graph this project queries:
//
//   (:Driver)-[:HAS_RESULT]->(:Result)-[:IN_RACE]->(:Race)-[:AT_CIRCUIT]->(:Circuit)
//   (:Result)-[:FOR_TEAM]->(:Team)          (:Race)-[:IN_SEASON]->(:Season)
//   (:Driver)-[:FINISHED_SEASON {position, points, wins}]->(:Season)
//   (:Team)-[:FINISHED_SEASON {position, points, wins}]->(:Season)
//
// Only Grand Prix race results are included (no sprints, qualifying or practice).

export type Row = Record<string, string>;
export type Tables = Record<string, Row[]>;

export type GraphData = {
  seasons: Array<{ year: number; complete: boolean }>;
  circuits: Array<{ id: string; name: string; locality: string; country: string }>;
  drivers: Array<{
    id: string;
    name: string;
    forename: string;
    surname: string;
    code: string | null;
    number: number | null;
    nationality: string | null;
    dateOfBirth: string | null;
  }>;
  teams: Array<{ id: string; name: string; nationality: string | null }>;
  races: Array<{ id: string; year: number; round: number; name: string; date: string; circuitId: string }>;
  results: Array<{
    raceId: string;
    driverId: string;
    teamId: string;
    position: number | null;
    grid: number | null;
    points: number;
    laps: number | null;
    status: string;
    classified: boolean;
    fastestLap: boolean;
    time: string | null;
  }>;
  driverStandings: Array<{ driverId: string; year: number; position: number; points: number; wins: number }>;
  teamStandings: Array<{ teamId: string; year: number; position: number; points: number; wins: number }>;
};

const table = (tables: Tables, name: string): Row[] => {
  const rows = tables[name];
  if (!rows) throw new Error(`Missing table ${name} in the dump`);
  return rows;
};

const int = (value: string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};
const num = (value: string | undefined): number => Number(value || 0);
const text = (value: string | undefined): string | null => (value ? value : null);
const yes = (value: string | undefined) => value === 't' || value === 'true' || value === '1';

const byId = (rows: Row[]) => new Map(rows.map((row) => [row.id!, row]));

/** Final standings: the last row of each season (highest round, then highest session). */
function finalStandings(rows: Row[]): Row[] {
  const lastByYear = new Map<string, [number, number]>();
  for (const row of rows) {
    const key: [number, number] = [num(row.round_number), num(row.session_number)];
    const best = lastByYear.get(row.year!);
    if (!best || key[0] > best[0] || (key[0] === best[0] && key[1] > best[1])) lastByYear.set(row.year!, key);
  }
  return rows.filter((row) => {
    const last = lastByYear.get(row.year!);
    return last && num(row.round_number) === last[0] && num(row.session_number) === last[1] && row.position;
  });
}

export function buildGraphData(tables: Tables): GraphData {
  const seasonsById = byId(table(tables, 'formula_one_season'));
  const circuitsById = byId(table(tables, 'formula_one_circuit'));
  const driversById = byId(table(tables, 'formula_one_driver'));
  const teamsById = byId(table(tables, 'formula_one_team'));
  const roundsById = byId(table(tables, 'formula_one_round'));
  const roundEntries = byId(table(tables, 'formula_one_roundentry'));
  const teamDrivers = byId(table(tables, 'formula_one_teamdriver'));

  const yearOf = (seasonId: string | undefined) => int(seasonsById.get(seasonId ?? '')?.year);
  const raceId = (round: Row) => `${yearOf(round.season_id)}-${round.number}`;

  // Grand Prix race sessions only.
  const raceSessions = new Map(
    table(tables, 'formula_one_session')
      .filter((session) => session.type === 'R' && !yes(session.is_cancelled))
      .map((session) => [session.id!, session]),
  );

  const results: GraphData['results'] = [];
  const roundsWithResults = new Set<string>();
  for (const entry of table(tables, 'formula_one_sessionentry')) {
    const session = raceSessions.get(entry.session_id!);
    if (!session) continue;
    const round = roundsById.get(session.round_id!);
    const roundEntry = roundEntries.get(entry.round_entry_id!);
    const teamDriver = teamDrivers.get(roundEntry?.team_driver_id ?? '');
    const driver = driversById.get(teamDriver?.driver_id ?? '');
    const team = teamsById.get(teamDriver?.team_id ?? '');
    if (!round || yes(round.is_cancelled) || !driver || !team) continue;

    roundsWithResults.add(round.id!);
    results.push({
      raceId: raceId(round),
      driverId: driver.reference!,
      teamId: team.reference!,
      position: int(entry.position),
      grid: int(entry.grid),
      points: num(entry.points),
      laps: int(entry.laps_completed),
      status: entry.detail || 'Unknown',
      classified: yes(entry.is_classified),
      fastestLap: entry.fastest_lap_rank === '1',
      time: text(entry.time),
    });
  }

  const rounds = [...roundsById.values()].filter((round) => !yes(round.is_cancelled));
  const races: GraphData['races'] = rounds
    .filter((round) => roundsWithResults.has(round.id!))
    .map((round) => ({
      id: raceId(round),
      year: yearOf(round.season_id)!,
      round: int(round.number)!,
      name: round.name!,
      date: round.date!,
      circuitId: circuitsById.get(round.circuit_id!)!.reference!,
    }));

  // A season is complete when every scheduled round has race results.
  const pendingYears = new Set(
    rounds.filter((round) => !roundsWithResults.has(round.id!)).map((round) => yearOf(round.season_id)),
  );
  const seasons = [...seasonsById.values()].map((season) => ({
    year: int(season.year)!,
    complete: !pendingYears.has(int(season.year)),
  }));

  const usedCircuits = new Set(races.map((race) => race.circuitId));
  const usedDrivers = new Set(results.map((result) => result.driverId));
  const usedTeams = new Set(results.map((result) => result.teamId));

  return {
    seasons,
    circuits: [...circuitsById.values()]
      .filter((circuit) => usedCircuits.has(circuit.reference!))
      .map((circuit) => ({
        id: circuit.reference!,
        name: circuit.name!,
        locality: circuit.locality ?? '',
        country: circuit.country ?? '',
      })),
    drivers: [...driversById.values()]
      .filter((driver) => usedDrivers.has(driver.reference!))
      .map((driver) => ({
        id: driver.reference!,
        name: `${driver.forename} ${driver.surname}`.trim(),
        forename: driver.forename ?? '',
        surname: driver.surname ?? '',
        code: text(driver.abbreviation),
        number: int(driver.permanent_car_number),
        nationality: text(driver.nationality),
        dateOfBirth: text(driver.date_of_birth),
      })),
    teams: [...teamsById.values()]
      .filter((team) => usedTeams.has(team.reference!))
      .map((team) => ({ id: team.reference!, name: team.name!, nationality: text(team.nationality) })),
    races,
    results,
    driverStandings: finalStandings(table(tables, 'formula_one_driverchampionship'))
      .filter((row) => driversById.has(row.driver_id!))
      .map((row) => ({
        driverId: driversById.get(row.driver_id!)!.reference!,
        year: int(row.year)!,
        position: int(row.position)!,
        points: num(row.points),
        wins: int(row.win_count) ?? 0,
      })),
    teamStandings: finalStandings(table(tables, 'formula_one_teamchampionship'))
      .filter((row) => teamsById.has(row.team_id!))
      .map((row) => ({
        teamId: teamsById.get(row.team_id!)!.reference!,
        year: int(row.year)!,
        position: int(row.position)!,
        points: num(row.points),
        wins: int(row.win_count) ?? 0,
      })),
  };
}
