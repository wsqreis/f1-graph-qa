/**
 * Hand-written schema for the prompt. Introspection would list labels and properties,
 * but not what they mean: that a win is position 1, that the current season's leader
 * is not a champion yet, or that grid 0 is a pit-lane start. Those rules are where
 * text-to-Cypher goes wrong, so they are spelled out here.
 */
export const GRAPH_SCHEMA = `Nodes:
- Driver {id: string, e.g. "hamilton", "max_verstappen", "michael_schumacher"; name: "Lewis Hamilton"; forename; surname; code: "HAM" or null; number: int or null; nationality: "British"; dateOfBirth: "YYYY-MM-DD" string}
- Team {id: "ferrari", "mclaren", "red_bull", "mercedes"; name: "Ferrari"; nationality}
- Circuit {id: "monaco", "silverstone", "monza", "spa"; name: "Circuit de Monaco"; locality: "Monte-Carlo"; country: "Monaco"}
- Race {id: "2021-22"; year: int; round: int; name: "Abu Dhabi Grand Prix"; date: Date}
- Season {year: int; complete: boolean}
- Result {position: int, finishing position; grid: int, starting position, 0 = pit lane start; points: float; laps: int; status: "Finished", "+1 Lap", "Engine", "Accident", "Collision", ...; classified: boolean; fastestLap: boolean; time: string or null}

Relationships:
- (:Driver)-[:HAS_RESULT]->(:Result)-[:IN_RACE]->(:Race)
- (:Result)-[:FOR_TEAM]->(:Team)
- (:Race)-[:AT_CIRCUIT]->(:Circuit)
- (:Race)-[:IN_SEASON]->(:Season)
- (:Driver)-[:FINISHED_SEASON {position: int, points: float, wins: int}]->(:Season)   final drivers' standings
- (:Team)-[:FINISHED_SEASON {position: int, points: float, wins: int}]->(:Season)     final constructors' standings (from 1958)

Meaning:
- One Result per driver per Grand Prix. Sprint races, qualifying and practice are not in the data.
- Win: Result.position = 1. Podium: position <= 3. Started from pole: grid = 1. Did not finish: classified = false.
- Season totals (points, wins, position) come from FINISHED_SEASON, which includes sprint points. Summing Result.points only counts Grand Prix points.
- A championship title is FINISHED_SEASON.position = 1 on a Season with complete = true. For the season in progress (complete = false), position 1 is only the current leader.
- Team names are historical: "Red Bull", "Toro Rosso", "AlphaTauri" and "RB" are different Team nodes; so are "Brawn" and "Mercedes".
- Ages and gaps between dates: duration.inDays(date(d.dateOfBirth), race.date).days gives total days. duration.between(...).days is only the days component of a years-months-days duration, so never use it to compare ages.
- Some surnames are shared (Schumacher: Michael, Ralf, Mick; Hill: Graham, Damon, Phil; Villeneuve: Gilles, Jacques). If the question only gives a shared surname, group results by driver name instead of merging them.`;

export const EXAMPLES = `Example questions and queries:

Q: Who has won the most races at Monaco?
MATCH (d:Driver)-[:HAS_RESULT]->(r:Result {position: 1})-[:IN_RACE]->(:Race)-[:AT_CIRCUIT]->(:Circuit {id: "monaco"})
RETURN d.name AS driver, count(*) AS wins ORDER BY wins DESC LIMIT 5

Q: How many world titles does Lewis Hamilton have?
MATCH (d:Driver)-[f:FINISHED_SEASON {position: 1}]->(s:Season {complete: true})
WHERE toLower(d.name) CONTAINS "hamilton"
RETURN d.name AS driver, count(s) AS titles, collect(s.year) AS years

Q: Which teams did Fernando Alonso drive for?
MATCH (d:Driver {id: "alonso"})-[:HAS_RESULT]->(r:Result)-[:FOR_TEAM]->(t:Team), (r)-[:IN_RACE]->(race:Race)
RETURN t.name AS team, min(race.year) AS firstYear, max(race.year) AS lastYear, count(r) AS races ORDER BY firstYear`;
