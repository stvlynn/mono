import { render } from "ink";
import { createElement } from "react";
import type { Agent } from "@mono/agent-core";
import type { TelegramControlEvent } from "@mono/telegram-control";
import type {
  ApprovalRequest,
  ChannelCapabilityProvider,
  InputImageAttachment,
} from "@mono/shared";
import { AppContainer } from "./AppContainer.js";

export interface InteractiveAppProps {
  agent: Agent;
  initialPrompt?: string;
  initialAttachments?: InputImageAttachment[];
}

export interface ChannelIntegrationHandle {
  readonly id: string;
  readonly provider?: ChannelCapabilityProvider;
  requestApproval?(request: ApprovalRequest): Promise<boolean | null>;
  reload?(): Promise<void>;
  flushPendingProfileApplication?(): Promise<void>;
  dispose(): Promise<void> | void;
}

export interface ChannelIntegrationContext {
  agent: Agent;
  onEventMessage: (event: TelegramControlEvent) => void;
  onChatError: (error: unknown, fallback: string) => void;
  onChatMessage: (request: unknown) => Promise<unknown>;
  applyProfile: (profileName: string) => Promise<void>;
  listConfiguredProfiles: () => Promise<Array<{
    name: string;
    model: {
      provider: string;
      modelId: string;
      baseURL: string;
    };
  }>>;
  isAgentBusy: () => boolean;
}

export interface ChannelIntegration {
  readonly id: string;
  attach(context: ChannelIntegrationContext): Promise<ChannelIntegrationHandle>;
}

export interface ChannelSurfaceAdapter {
  readonly id: string;
  run(options: InteractiveAppProps & { registry: ChannelRegistry }): Promise<void>;
}

export class ChannelRegistry {
  readonly #surfaces = new Map<string, ChannelSurfaceAdapter>();
  readonly #integrations = new Map<string, ChannelIntegration>();

  registerSurface(adapter: ChannelSurfaceAdapter): this {
    if (this.#surfaces.has(adapter.id)) {
      throw new Error(`Surface channel already registered: ${adapter.id}`);
    }
    this.#surfaces.set(adapter.id, adapter);
    return this;
  }

  registerIntegration(integration: ChannelIntegration): this {
    if (this.#integrations.has(integration.id)) {
      throw new Error(`Channel integration already registered: ${integration.id}`);
    }
    this.#integrations.set(integration.id, integration);
    return this;
  }

  resolveSurface(id: string): ChannelSurfaceAdapter | undefined {
    return this.#surfaces.get(id);
  }

  listIntegrations(): ChannelIntegration[] {
    return [...this.#integrations.values()];
  }
}

export function createTuiSurfaceAdapter(): ChannelSurfaceAdapter {
  return {
    id: "tui",
    async run(options) {
      const app = render(createElement(AppContainer, {
        ...options,
        channelRegistry: options.registry,
      }), {
        exitOnCtrlC: false,
      });
      await app.waitUntilExit();
    },
  };
}
