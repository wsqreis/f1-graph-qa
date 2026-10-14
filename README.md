# f1-graph-qa

[![CI](https://github.com/wsqreis/f1-graph-qa/actions/workflows/ci.yml/badge.svg)](https://github.com/wsqreis/f1-graph-qa/actions/workflows/ci.yml)

Ask questions about **Formula 1 history** in plain English. An LLM writes a Cypher query over a Neo4j graph of every Grand Prix since 1950, fixes it when it fails, and answers only from what the database returns. The query and rows behind each answer are one click away.

> *"What is the furthest back on the grid anyone has started and still won a race?"*
> → John Watson, from 22nd, at the 1983 United States Grand Prix West.

Built with **LangGraph** (TypeScript), **Neo4j**, **OpenRouter** (free models by default) and **Fastify**.

## The graph

77 seasons, 1,164 Grands Prix, 818 drivers, 205 teams and 26,203 race results, loaded from the [Jolpica F1](https://github.com/jolpica/jolpica-f1) database dump (the open successor of the Ergast API).

```
(:Driver)-[:HAS_RESULT]->(:Result)-[:IN_RACE]->(:Race)-[:AT_CIRCUIT]->(:Circuit)
                            │                     │
                     [:FOR_TEAM]             [:IN_SEASON]
                            ▼                     ▼
                         (:Team)              (:Season)
(:Driver|Team)-[:FINISHED_SEASON {position, points, wins}]->(:Season)
```

The relational dump (sessions, round entries, team-driver contracts) is flattened into this shape by a pure, unit-tested transform (`src/data/transform.ts`), so the LLM has fewer hops to get right.

## How a question is answered

```
question ─▶ generate ─▶ execute ──── rows ───▶ answer
               ▲           │
               └─ problem ─┘  (guard rejection, Neo4j error or no rows; up to 3 attempts)
```

1. **generate**: structured output `{cypher, unanswerable}`. The prompt carries a hand-written schema that explains what the data *means*, not just its labels: a win is `position = 1`, `grid = 0` is a pit-lane start, and the leader of the season in progress is not a champion yet (`Season.complete`). Three verified example queries are included.
2. **execute**: the query passes a static read-only guard, then runs in a READ transaction with a 5-second timeout and a 100-row cap.
3. **self-correction**: syntax errors, guard rejections *and empty results* go back to the model with the failing query and the reason. Empty results usually mean a wrong name filter ("Raikkonen" vs "Räikkönen"), so they get a retry too.
4. **answer**: the reply is written from the rows only; the model is told not to add statistics from memory. Questions the data can't answer (predictions, pit stops, sprints) are declined without touching the database.

Follow-up questions work within a conversation ("Who won in 2008?" → "And in 2009?").

## Safety: LLM-written queries against a database

| Layer | What it stops |
|---|---|
| Static guard (`src/db/guard.ts`) | `CREATE`, `MERGE`, `DELETE`, `SET`, `LOAD CSV`, procedure `CALL`s, `USE`, multiple statements; string literals and comments are stripped first, so `"Set off"` is not a false positive |
| READ access mode | Neo4j itself rejects any write that gets past the guard (covered by an integration test) |
| Transaction timeout + row cap | Runaway queries and huge results |

With Neo4j Enterprise or Aura you would add a third layer: a database user with read-only privileges.

## Evaluation

`npm run eval` measures **execution accuracy**, the standard text-to-SQL metric: the agent's final query and a hand-written reference query both run against the database, and their results are compared (ignoring column names and order, allowing extra columns, and accepting the answer inside a short top-N list).

The 27 questions cover counts, rankings, single facts, multi-hop joins (Verstappen's first Red Bull teammate), date arithmetic (youngest winner), the in-progress-season trap (Mercedes' titles, the 2026 leader), a name with diacritics, and two questions that must be declined. Every reference query is checked against the database by the integration tests.

```bash
npm run eval                                                   # the configured model chain
npm run eval -- --models nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free   # each model on its own
```

The report includes how many questions passed only thanks to self-correction. `--only id1,id2` re-runs a subset.

<!-- Results table: run `npm run eval` per model and paste the summary here. -->

## Run it

Requires Node.js 22.18+, Docker and a free [OpenRouter API key](https://openrouter.ai/keys).

```bash
npm install
cp .env.example .env      # add OPENROUTER_API_KEY
npm run db:up             # Neo4j 5 Community, capped at 1 GB of RAM
npm run data:download     # Jolpica CSV dump into data/raw (~60 MB unzipped)
npm run data:load         # builds the graph (~25 s)
npm run dev               # http://127.0.0.1:3000
```

Neo4j Browser is at http://127.0.0.1:7474 (user `neo4j`, password from `.env`) if you want to explore the graph yourself.

### API

`POST /api/ask` with `{ "question": "...", "threadId": "optional uuid" }` returns `{ threadId, answer, cypher, columns, rows, attempts }`.

## Tests

```bash
npm test           # unit tests always; integration tests when Neo4j is up with data loaded
npm run typecheck
```

- **Unit**: guard, result comparison, the relational-to-graph transform, and the agent graph with a scripted model and a fake database (retry on errors, retry on empty results, write queries never reaching the database, attempt limit, follow-ups).
- **Integration**: value conversion from Neo4j, READ mode refusing writes, and every eval reference query returning rows.

## Project layout

```
src/
├── agent/      # LangGraph: generate → execute → (retry) → answer, prompts
├── db/         # schema for the prompt, read-only guard, Neo4j runner
├── data/       # CSV reading, relational → graph transform, loader
├── llm/        # ChatModel interface + OpenRouter (fallback models)
└── server.ts   # Fastify API + demo page
scripts/        # download and load the data
eval/           # questions with reference queries, comparison, runner
```

## Data and limits

- Data: [Jolpica F1](https://github.com/jolpica/jolpica-f1) public database dump, free for non-commercial use. The public dump lags 14 days behind; the current season is marked incomplete.
- Only Grand Prix race results are loaded. Sprint races, qualifying, lap times and pit stops are in the dump but not in the graph yet. "Pole position" is approximated by starting position (`grid = 1`), which differs from qualifying position when grid penalties apply.

## License

Code: [MIT](LICENSE). Data: see Jolpica F1's terms.
