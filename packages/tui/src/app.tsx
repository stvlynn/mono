import React from "react";
import type { InteractiveAppProps } from "./channel-registry.js";
import { ChannelRegistry, createTuiSurfaceAdapter } from "./channel-registry.js";
import { createTelegramChannelIntegration } from "./integrations/telegram.js";

export async function runInteractiveApp(options: InteractiveAppProps): Promise<void> {
  const registry = new ChannelRegistry()
    .registerSurface(createTuiSurfaceAdapter())
    .registerIntegration(createTelegramChannelIntegration());
  const surface = registry.resolveSurface("tui");
  if (!surface) {
    throw new Error('No local surface registered for channel "tui"');
  }
  await surface.run({
    ...options,
    registry,
  });
}
