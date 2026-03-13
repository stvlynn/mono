import type { ContextAssemblyReport } from "@mono/shared";
import { createInitializedAgent } from "../runtime.js";

export interface ContextInspectResult {
  systemPrompt: string;
  report: ContextAssemblyReport;
}

export async function runContextInspect(prompt?: string): Promise<ContextInspectResult> {
  const agent = await createInitializedAgent();
  return agent.inspectContext(prompt);
}
