import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from '../src/agent/graph.ts';
import type { QueryResult, QueryRunner } from '../src/db/runner.ts';
import type { ChatModel } from '../src/llm/model.ts';

type Generation = { cypher: string | null; unanswerable?: string | null };

class ScriptedModel implements ChatModel {
  readonly generations: Generation[];
  readonly extractCalls: BaseMessage[][] = [];
  readonly replyCalls: BaseMessage[][] = [];
  constructor(...generations: Generation[]) {
    this.generations = generations;
  }
  async extract(_schema: unknown, messages: BaseMessage[]): Promise<never> {
    this.extractCalls.push(messages);
    const next = this.generations.shift();
    if (!next) throw new Error('no generation scripted');
    return { unanswerable: null, ...next } as never;
  }
  async reply(messages: BaseMessage[]): Promise<string> {
    this.replyCalls.push(messages);
    return 'answer';
  }
}

/** Fake database: answers by exact query text; anything else is a syntax error. */
class FakeDb implements QueryRunner {
  readonly ran: string[] = [];
  readonly answers: Record<string, QueryResult['rows']>;
  constructor(answers: Record<string, QueryResult['rows']>) {
    this.answers = answers;
  }
  async run(cypher: string): Promise<QueryResult> {
    this.ran.push(cypher);
    const rows = this.answers[cypher];
    if (!rows) throw new Error('Invalid input: syntax error');
    return { columns: Object.keys(rows[0] ?? {}), rows, truncated: false };
  }
  async dataUntil() {
    return '2026-09-26';
  }
}

const GOOD = 'MATCH (d:Driver) RETURN d.name AS driver';
const ask = (model: ChatModel, db: QueryRunner, question: string, thread = 't') =>
  buildAgent(model, db, { checkpointer: new MemorySaver() }).invoke(
    { messages: [new HumanMessage(question)] },
    { configurable: { thread_id: thread } },
  );

describe('text-to-Cypher agent', () => {
  it('runs the generated query and answers from its rows', async () => {
    const model = new ScriptedModel({ cypher: GOOD });
    const db = new FakeDb({ [GOOD]: [{ driver: 'Ayrton Senna' }] });
    const state = await ask(model, db, 'Who?');

    assert.equal(state.attempts, 1);
    assert.deepEqual(state.result?.rows, [{ driver: 'Ayrton Senna' }]);
    assert.equal(state.messages.at(-1)?.content, 'answer');
    const prompt = String(model.replyCalls[0]![1]!.content);
    assert.match(prompt, /Ayrton Senna/);
    assert.match(String(model.replyCalls[0]![0]!.content), /1950 to 2026-09-26/);
  });

  it('feeds a database error back and retries with the corrected query', async () => {
    const model = new ScriptedModel({ cypher: 'MATCH (d:Driver RETURN d' }, { cypher: GOOD });
    const db = new FakeDb({ [GOOD]: [{ driver: 'x' }] });
    const state = await ask(model, db, 'Who?');

    assert.equal(state.attempts, 2);
    assert.equal(state.problem, null);
    assert.match(String(model.extractCalls[1]![0]!.content), /MATCH \(d:Driver RETURN d\nProblem: Neo4j error: Invalid input/);
  });

  it('never sends a write query to the database', async () => {
    const model = new ScriptedModel({ cypher: 'MATCH (d:Driver) DETACH DELETE d RETURN 1' }, { cypher: GOOD });
    const db = new FakeDb({ [GOOD]: [{ driver: 'x' }] });
    await ask(model, db, 'Delete everything');

    assert.deepEqual(db.ran, [GOOD]);
    assert.match(String(model.extractCalls[1]![0]!.content), /not allowed; queries are read-only/);
  });

  it('treats empty results as worth one more try', async () => {
    const empty = 'MATCH (d:Driver {name: "Raikkonen"}) RETURN d.name';
    const model = new ScriptedModel({ cypher: empty }, { cypher: GOOD });
    const db = new FakeDb({ [empty]: [], [GOOD]: [{ driver: 'Kimi Räikkönen' }] });
    const state = await ask(model, db, 'Raikkonen?');
    assert.equal(state.attempts, 2);
    assert.equal(state.result?.rows.length, 1);
  });

  it('gives up after the attempt limit and says so', async () => {
    const model = new ScriptedModel({ cypher: 'bad 1' }, { cypher: 'bad 2' }, { cypher: 'bad 3' });
    const state = await ask(model, new FakeDb({}), 'Who?');
    assert.equal(state.attempts, 3);
    assert.equal(state.result, null);
    assert.match(String(model.replyCalls[0]![1]!.content), /could not be run after 3 attempts/);
  });

  it('skips the database for questions the data cannot answer', async () => {
    const model = new ScriptedModel({ cypher: null, unanswerable: 'Predictions are not in the data' });
    const db = new FakeDb({});
    const state = await ask(model, db, 'Who wins in 2030?');
    assert.deepEqual(db.ran, []);
    assert.equal(state.unanswerable, 'Predictions are not in the data');
  });

  it('resets per-question state and passes history for follow-ups', async () => {
    const second = 'MATCH (s:Season {year: 2020}) RETURN s.year AS year';
    const model = new ScriptedModel({ cypher: 'bad' }, { cypher: GOOD }, { cypher: second });
    const db = new FakeDb({ [GOOD]: [{ driver: 'x' }], [second]: [{ year: 2020 }] });
    const agent = buildAgent(model, db, { checkpointer: new MemorySaver() });
    const thread = { configurable: { thread_id: 'follow-up' } };

    await agent.invoke({ messages: [new HumanMessage('Champion in 2019?')] }, thread);
    const state = await agent.invoke({ messages: [new HumanMessage('And in 2020?')] }, thread);

    assert.equal(state.attempts, 1, 'attempts start over for each question');
    const generateMessages = model.extractCalls[2]!.map((message) => String(message.content));
    assert.ok(generateMessages.includes('Champion in 2019?'));
    assert.equal(generateMessages.at(-1), 'And in 2020?');
  });
});
