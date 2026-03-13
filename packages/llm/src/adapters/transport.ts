import type { UnifiedModel } from "@mono/shared";

export function resolveModelTransport(model: {
  family: UnifiedModel["family"];
  transport?: string;
  runtimeProviderKey?: string;
}): NonNullable<UnifiedModel["transport"]> {
  if (model.transport === "openai-compatible" || model.transport === "anthropic" || model.transport === "gemini") {
    return model.transport;
  }

  const runtimeKind = model.runtimeProviderKey?.split(":").at(-1);
  if (runtimeKind === "openai-compatible" || runtimeKind === "anthropic" || runtimeKind === "gemini") {
    return runtimeKind;
  }

  return model.family;
}
