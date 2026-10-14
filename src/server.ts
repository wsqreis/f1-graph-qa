import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HumanMessage } from '@langchain/core/messages';
import Fastify from 'fastify';
import type { Agent } from './agent/graph.ts';

const askBody = {
  type: 'object',
  required: ['question'],
  properties: {
    question: { type: 'string', minLength: 1, maxLength: 500 },
    threadId: { type: 'string', format: 'uuid' },
  },
} as const;

export function buildApp(agent: Agent) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/', async (_, reply) =>
    reply.type('text/html').send(await readFile(new URL('../public/index.html', import.meta.url), 'utf8')),
  );
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post<{ Body: { question: string; threadId?: string } }>('/api/ask', { schema: { body: askBody } }, async (request) => {
    const threadId = request.body.threadId ?? randomUUID();
    const state = await agent.invoke(
      { messages: [new HumanMessage(request.body.question)] },
      { configurable: { thread_id: threadId } },
    );
    const last = state.messages.at(-1);
    return {
      threadId,
      answer: typeof last?.content === 'string' ? last.content : '',
      // The query and rows behind the answer, so every claim can be checked.
      cypher: state.result ? state.cypher : null,
      columns: state.result?.columns ?? [],
      rows: state.result?.rows ?? [],
      attempts: state.attempts,
    };
  });

  app.setErrorHandler((error, request, reply) => {
    if ((error as { validation?: unknown }).validation) return reply.status(400).send({ error: (error as Error).message });
    request.log.error(error);
    return reply.status(502).send({ error: 'Something went wrong answering that. Please try again.' });
  });

  return app;
}
