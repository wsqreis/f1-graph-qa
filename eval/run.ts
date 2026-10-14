// Text-to-Cypher evaluation against the real database.
//
//   npm run eval                                  # the configured model chain
//   npm run eval -- --models a/model:free,b/model  # each model on its own
//
// For each question, the agent's final query (after any self-correction) is compared
// with a hand-written reference query by execution result. Questions with a null
// reference must be declined instead of answered.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HumanMessage } from '@langchain/core/messages';
import { buildAgent } from '../src/agent/graph.ts';
import { loadConfig } from '../src/config.ts';
import { Neo4jRunner } from '../src/db/runner.ts';
import { type ChatModel, OpenRouterModel } from '../src/llm/model.ts';
import { sameAnswer } from './compare.ts';

type Case = { id: string; question: string; reference: string | null };

const PAUSE_MS = 1500; // free models are rate limited

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error('Set OPENROUTER_API_KEY in .env first.');
  process.exit(1);
}
const flag = process.argv.indexOf('--models');
const runs = flag > -1 ? (process.argv[flag + 1] ?? '').split(',').filter(Boolean) : [config.llm.models.join(',')];
const cases: Case[] = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const db = new Neo4jRunner(config.neo4j);

/** The eval scores queries, not prose: the final answer step is skipped. */
class QueriesOnly implements ChatModel {
  readonly #inner: ChatModel;
  constructor(inner: ChatModel) {
    this.#inner = inner;
  }
  extract: ChatModel['extract'] = (schema, messages) => this.#inner.extract(schema, messages);
  async reply() {
    return '';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '-');

await mkdir(new URL('./results/', import.meta.url), { recursive: true });
try {
  for (const run of runs) {
    const label = run.split(',')[0]!;
    const agent = buildAgent(new QueriesOnly(new OpenRouterModel({ ...config.llm, models: run.split(',') })), db);
    console.log(`\n== ${label}${run.includes(',') ? ' (with fallbacks)' : ''}`);

    const results = [];
    for (const testCase of cases) {
      const started = performance.now();
      try {
        const state = await agent.invoke({ messages: [new HumanMessage(testCase.question)] });
        const latencyMs = performance.now() - started;
        let passed: boolean;
        if (testCase.reference === null) {
          passed = state.unanswerable !== null;
        } else {
          const expected = await db.run(testCase.reference);
          passed = state.result !== null && sameAnswer(expected.rows, state.result.rows);
        }
        results.push({
          id: testCase.id,
          passed,
          attempts: state.attempts,
          cypher: state.cypher,
          rows: state.result?.rows.slice(0, 5) ?? null,
          problem: state.problem,
          latencyMs,
        });
        const note = state.attempts > 1 ? ` (${state.attempts} attempts)` : '';
        console.log(`${passed ? 'pass' : 'FAIL'}  ${testCase.id}${note}${passed ? '' : `\n      ${state.cypher ?? state.unanswerable}`}`);
      } catch (error) {
        results.push({ id: testCase.id, passed: false, error: String(error) });
        console.log(`ERR   ${testCase.id}  ${error instanceof Error ? error.message : error}`);
      }
      await sleep(PAUSE_MS);
    }

    const passed = results.filter((result) => result.passed).length;
    const corrected = results.filter((result) => result.passed && (result.attempts ?? 0) > 1).length;
    const timed = results.filter((result) => result.latencyMs);
    const avg = timed.reduce((sum, result) => sum + (result.latencyMs ?? 0), 0) / (timed.length || 1);
    console.log(`\nexecution accuracy: ${passed}/${cases.length} (${pct(passed, cases.length)})`);
    console.log(`passed only after self-correction: ${corrected}`);
    console.log(`avg time to final query: ${(avg / 1000).toFixed(1)}s`);

    const file = new URL(`./results/${label.replace(/[^\w.-]+/g, '_')}-${Date.now()}.json`, import.meta.url);
    await writeFile(file, JSON.stringify({ model: run, ranAt: new Date().toISOString(), passed, total: cases.length, results }, null, 2));
  }
} finally {
  await db.close();
}
