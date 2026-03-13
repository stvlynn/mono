import { stdout as output } from "node:process";
import { Command } from "commander";
import { runAuthLogin, runAuthLogout, runAuthStatus } from "../use-cases/auth.js";
import { writeJson, writeLine } from "../output.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage model authentication and profiles");

  auth
    .command("login")
    .description("Create or update a mono profile in ~/.mono")
    .option("--profile <profile>", "profile name")
    .option("--provider <provider>", "provider id")
    .option("--model <model>", "model id")
    .option("--base-url <baseUrl>", "provider base URL")
    .option("--api-key-env <envVar>", "environment variable to read the API key from")
    .option("--with-api-key", "read the API key from stdin")
    .option("--default", "set this profile as the default")
    .option("--project", "bind the current project to this profile")
    .option("--refresh", "refresh the remote models catalog before prompting")
    .action(async (options) => {
      const result = await runAuthLogin({
        profile: options.profile,
        provider: options.provider,
        model: options.model,
        baseUrl: options.baseUrl,
        apiKeyEnv: options.apiKeyEnv,
        withApiKey: options.withApiKey,
        setDefault: options.default,
        bindProject: options.project,
        refresh: options.refresh
      });
      writeLine(`Saved profile ${result.profile} to ~/.mono/config.json`);
    });

  auth
    .command("status")
    .description("Show resolved auth and profile status")
    .option("--json", "output JSON")
    .action(async (options) => {
      const payload = await runAuthStatus();
      if (options.json) {
        writeJson(payload);
        return;
      }

      output.write(`Config dir: ${payload.summary.configDir}\n`);
      output.write(`Default profile: ${payload.summary.defaultProfile ?? "<none>"}\n`);
      output.write(`Resolved profile: ${payload.resolved.profileName}\n`);
      output.write(`Resolved model: ${payload.resolved.model.provider}/${payload.resolved.model.modelId}\n`);
      output.write(`Base URL: ${payload.resolved.model.baseURL}\n`);
      output.write(`API key source: ${payload.resolved.source.apiKey}\n`);
      for (const profile of payload.profiles) {
        output.write(`- ${profile.name}: ${profile.profile.provider}/${profile.profile.modelId} -> ${profile.profile.baseURL}\n`);
      }
    });

  auth
    .command("logout")
    .description("Remove secrets for a profile and optionally delete the profile")
    .argument("[profile]", "profile name", "default")
    .option("--remove-profile", "remove the profile from config.json too")
    .action(async (profile: string, options) => {
      const result = await runAuthLogout(profile, Boolean(options.removeProfile));
      writeLine(`Removed secret for profile ${result.profile}`);
    });
}
