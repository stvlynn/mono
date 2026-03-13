import { resolveMonoConfig } from "@mono/config";
import { createDistributor, type Distributor } from "@mono/im-platform";

export interface TelegramNotifier {
  sendText(chatId: string, text: string): Promise<void>;
}

export async function createTelegramNotifier(
  cwd = process.cwd(),
): Promise<TelegramNotifier | null> {
  const resolved = await resolveMonoConfig({ cwd });
  const telegram = resolved.channels.telegram;
  if (!telegram.enabled || !telegram.botToken) {
    return null;
  }

  const distributor = createDistributor({
    builtInProviders: [
      {
        platform: "telegram",
        id: "telegram-control",
        botToken: telegram.botToken,
        defaultTextFormat: "markdown",
      },
    ],
  });

  return createNotifierFromDistributor(distributor);
}

export function createNotifierFromDistributor(distributor: Distributor): TelegramNotifier {
  return {
    async sendText(chatId: string, text: string): Promise<void> {
      await distributor.dispatch({
        provider: "telegram-control",
        target: {
          kind: "dm",
          address: chatId,
        },
        content: {
          type: "text",
          text,
          format: "markdown",
        },
      });
    },
  };
}
