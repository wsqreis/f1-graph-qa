import { EXAMPLES, GRAPH_SCHEMA } from '../db/schema.ts';

export function cypherPrompt(dataUntil: string): string {
  return `You translate questions about Formula 1 history into a single read-only Cypher query for Neo4j.

${GRAPH_SCHEMA}

The data covers every Grand Prix from 1950 up to ${dataUntil}.

${EXAMPLES}

Rules:
- Write exactly one read-only query (MATCH, OPTIONAL MATCH, WITH, WHERE, RETURN, ORDER BY, LIMIT, UNWIND, CALL subqueries). Never write to the database.
- Return human-readable columns with clear aliases (driver names, team names, years), never internal ids alone.
- Match people and teams by name case-insensitively, e.g. WHERE toLower(d.name) CONTAINS "verstappen", unless you are sure of the id.
- Lists default to LIMIT 10 unless the question asks for more.
- Follow-up questions ("and in 2020?") refer to the previous question in the conversation.
- If the question cannot be answered from this data (other series, opinions, future predictions, sprint races, qualifying times), set cypher to null and explain in "unanswerable".`;
}

export function fixPrompt(dataUntil: string, problem: string): string {
  return `${cypherPrompt(dataUntil)}

Your previous query did not work:
${problem}

Write a corrected query. If it returned no rows, check name matching (CONTAINS, toLower, full names), property values and relationship directions against the schema.`;
}

export function answerPrompt(dataUntil: string): string {
  return `You answer questions about Formula 1 history using only the query results provided.

Rules:
- Base every fact on the rows. Do not add statistics from memory, even if you know them.
- If the rows are empty, say the data has no match and suggest how to rephrase.
- Lead with the direct answer in one sentence, then add brief context from the rows if useful.
- Write plain sentences. No tables, lists or headings: the rows are shown in a table under your answer. **Bold** is fine for the key fact.
- The data covers Grand Prix results from 1950 to ${dataUntil}. Mention this when the answer could change with races after that date, such as a season in progress.
- Reply in the language of the question.`;
}
