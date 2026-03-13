import { Command } from "commander";
import { runModelsList } from "../use-cases/models.js";

export function registerModelsCommand(program: Command): void {
  program
    .command("models")
    .description("List available models")
    .argument("[provider]", "provider id to filter models by")
    .option("--refresh", "refresh the remote models catalog before listing")
    .action(async (provider: string | undefined, options) => {
      const payload = await runModelsList(provider, Boolean(options.refresh));
      for (const model of payload.models) {
        console.log(`${model.provider}/${model.modelId} -> ${model.baseURL}`);
      }
      if (payload.profiles.length > 0) {
        console.log("profiles:");
        for (const profile of payload.profiles) {
          console.log(`  ${profile.name} -> ${profile.model.provider}/${profile.model.modelId}`);
        }
      }
    });
}
