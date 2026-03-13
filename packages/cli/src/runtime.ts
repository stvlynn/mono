import { Agent } from "@mono/agent-core";

export function createAgent(options: ConstructorParameters<typeof Agent>[0] = {}): Agent {
  return new Agent({
    cwd: process.cwd(),
    ...options
  });
}

export async function createInitializedAgent(options: ConstructorParameters<typeof Agent>[0] = {}): Promise<Agent> {
  const agent = createAgent(options);
  await agent.initialize();
  return agent;
}

export function requireOpenVikingConfig(agent: Agent): NonNullable<ReturnType<Agent["getResolvedConfig"]>["memory"]["openViking"]> {
  const config = agent.getResolvedConfig().memory.openViking;
  if (!config.enabled || !config.url) {
    throw new Error("OpenViking is not configured. Set mono.memory.openViking.enabled=true and mono.memory.openViking.url.");
  }
  return config;
}

export function requireSeekDbConfig(agent: Agent): NonNullable<ReturnType<Agent["getResolvedConfig"]>["memory"]["seekDb"]> {
  const config = agent.getResolvedConfig().memory.seekDb;
  if (!config.enabled) {
    throw new Error("SeekDB is not configured. Set mono.memory.seekDb.enabled=true.");
  }
  if (config.mode === "mysql" && !config.database) {
    throw new Error("SeekDB MySQL mode requires mono.memory.seekDb.database to be configured.");
  }
  if (config.mode === "python-embedded" && !config.embeddedPath) {
    throw new Error("SeekDB python-embedded mode requires mono.memory.seekDb.embeddedPath to be configured.");
  }
  return config;
}
