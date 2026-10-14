import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, type BaseCheckpointSaver, END, messagesStateReducer, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { checkReadOnly } from '../db/guard.ts';
import type { QueryResult, QueryRunner } from '../db/runner.ts';
import type { ChatModel } from '../llm/model.ts';
import { answerPrompt, cypherPrompt, fixPrompt } from './prompts.ts';

const generation = z.object({
  cypher: z.string().nullable().describe('A single read-only Cypher query, or null if the data cannot answer the question'),
  unanswerable: z.string().nullable().describe('Why the question cannot be answered from this data, when cypher is null'),
});

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  cypher: Annotation<string | null>({ reducer: (_, next) => next, default: () => null }),
  result: Annotation<QueryResult | null>({ reducer: (_, next) => next, default: () => null }),
  /** Why the last query failed: guard rejection, database error, or no rows. */
  problem: Annotation<string | null>({ reducer: (_, next) => next, default: () => null }),
  unanswerable: Annotation<string | null>({ reducer: (_, next) => next, default: () => null }),
  attempts: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
});
type State = typeof AgentState.State;
type Update = typeof AgentState.Update;

/** Some models write the string "None" or "null" instead of a JSON null when declining. */
const noQuery = (cypher: string | null | undefined) => !cypher || /^\s*(none|null|n\/a)?\s*$/i.test(cypher);

/** Earlier questions and answers, so follow-ups like "and in 2020?" can be resolved. */
const HISTORY = 4;

export function buildAgent(
  model: ChatModel,
  db: QueryRunner,
  options: { checkpointer?: BaseCheckpointSaver; maxAttempts?: number } = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  let dataUntil: Promise<string> | undefined;
  const until = () => (dataUntil ??= db.dataUntil());

  // Each question starts clean; only the messages carry over between turns.
  const reset = (): Update => ({ cypher: null, result: null, problem: null, unanswerable: null, attempts: 0 });

  async function generate(state: State): Promise<Update> {
    const system = state.problem
      ? fixPrompt(await until(), `Query:\n${state.cypher}\nProblem: ${state.problem}`)
      : cypherPrompt(await until());
    const output = await model.extract(generation, [new SystemMessage(system), ...state.messages.slice(-HISTORY - 1)]);
    const cypher = noQuery(output.cypher) ? null : output.cypher!.trim();
    return {
      cypher,
      unanswerable: cypher ? null : output.unanswerable || 'That question is outside the F1 results data.',
      attempts: state.attempts + 1,
    };
  }

  async function execute(state: State): Promise<Update> {
    const checked = checkReadOnly(state.cypher ?? '');
    if (!checked.ok) return { problem: checked.reason, result: null };
    try {
      const result = await db.run(checked.cypher);
      return {
        cypher: checked.cypher,
        result,
        // Empty results usually mean a wrong name or filter, so they get one more try too.
        problem: result.rows.length === 0 ? 'The query ran but returned no rows.' : null,
      };
    } catch (error) {
      return { problem: `Neo4j error: ${error instanceof Error ? error.message : String(error)}`, result: null };
    }
  }

  async function answer(state: State): Promise<Update> {
    const question = state.messages.at(-1);
    let context: string;
    if (state.unanswerable) {
      context = `No query was run. Reason: ${state.unanswerable}\nExplain briefly what this assistant can answer instead (F1 Grand Prix results, drivers, teams, circuits, championships since 1950).`;
    } else if (!state.result) {
      context = `The query could not be run after ${state.attempts} attempts. Last problem: ${state.problem}\nApologise briefly and suggest rephrasing.`;
    } else {
      const { rows, truncated } = state.result;
      context = `Query:\n${state.cypher}\n\nRows${truncated ? ' (first 100)' : ''}:\n${JSON.stringify(rows)}`;
    }
    const reply = await model.reply([
      new SystemMessage(answerPrompt(await until())),
      new HumanMessage(`Question: ${String(question?.content ?? '')}\n\n${context}`),
    ]);
    return { messages: [new AIMessage(reply)] };
  }

  const afterGenerate = (state: State) => (state.cypher ? 'execute' : 'answer');
  const afterExecute = (state: State) => (state.problem && state.attempts < maxAttempts ? 'generate' : 'answer');

  return new StateGraph(AgentState)
    .addNode('start', reset)
    .addNode('generate', generate)
    .addNode('execute', execute)
    .addNode('answer', answer)
    .addEdge(START, 'start')
    .addEdge('start', 'generate')
    .addConditionalEdges('generate', afterGenerate, ['execute', 'answer'])
    .addConditionalEdges('execute', afterExecute, ['generate', 'answer'])
    .addEdge('answer', END)
    .compile({ checkpointer: options.checkpointer });
}

export type Agent = ReturnType<typeof buildAgent>;
