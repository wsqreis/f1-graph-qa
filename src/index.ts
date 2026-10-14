import { MemorySaver } from '@langchain/langgraph';
import { buildAgent } from './agent/graph.ts';
import { loadConfig } from './config.ts';
import { Neo4jRunner } from './db/runner.ts';
import { OpenRouterModel } from './llm/model.ts';
import { buildApp } from './server.ts';

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error('OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const db = new Neo4jRunner(config.neo4j);
const agent = buildAgent(new OpenRouterModel(config.llm), db, { checkpointer: new MemorySaver() });
const app = buildApp(agent);
app.addHook('onClose', () => db.close());

await app.listen({ port: config.port, host: config.host });
