import { describe, expect, it } from "vitest";
import { getAdapterForModel, ModelRegistry } from "../packages/llm/src/index.js";

describe("llm adapters", () => {
  it("routes anthropic models to the anthropic xsai adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("anthropic/claude-sonnet-4-5");
    const adapter = getAdapterForModel(model);

    expect(model.family).toBe("anthropic");
    expect(adapter.id).toBe("xsai-anthropic");
  });

  it("routes openai-compatible models to the generic xsai adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("openai/gpt-4.1-mini");
    const adapter = getAdapterForModel(model);

    expect(adapter.id).toBe("xsai-openai-compatible");
  });
});
