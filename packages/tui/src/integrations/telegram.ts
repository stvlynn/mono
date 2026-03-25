import type {
  TelegramChatRequest,
  TelegramChatResponse,
  TelegramControlEvent,
} from "@mono/telegram-control";
import type { ChannelIntegration, ChannelIntegrationContext, ChannelIntegrationHandle } from "../channel-registry.js";
import { loadTelegramControlModule } from "../load-telegram-control.js";

export function createTelegramChannelIntegration(): ChannelIntegration {
  return {
    id: "telegram",
    async attach(context: ChannelIntegrationContext): Promise<ChannelIntegrationHandle> {
      const telegramConfig = context.agent.getResolvedConfig().channels.telegram;
      if (!telegramConfig.enabled || !telegramConfig.botToken) {
        return {
          id: "telegram",
          dispose() {},
        };
      }

      const { TelegramControlRuntime } = await loadTelegramControlModule();
      const runtime = new TelegramControlRuntime({
        cwd: process.cwd(),
        onEvent: (event: TelegramControlEvent) => {
          context.onEventMessage(event);
        },
        onChatMessage: (request: TelegramChatRequest) =>
          context.onChatMessage(request) as Promise<TelegramChatResponse | string | null>,
        applyProfile: context.applyProfile,
        listConfiguredProfiles: context.listConfiguredProfiles,
        isAgentBusy: context.isAgentBusy,
      });
      await runtime.start();

      return {
        id: "telegram",
        provider: runtime,
        requestApproval: (request) => runtime.requestApproval(request),
        reload: () => runtime.reload(),
        flushPendingProfileApplication: () => runtime.flushPendingProfileApplication(),
        async dispose() {
          await runtime.stop();
        },
      };
    },
  };
}
