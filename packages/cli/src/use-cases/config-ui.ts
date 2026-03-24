import { startConfigUiServer, type StartConfigUiServerOptions } from "../config-ui/server.js";

export interface RunConfigUiResult {
  url: string;
}

export async function runConfigUi(options: StartConfigUiServerOptions = {}): Promise<RunConfigUiResult> {
  const { url } = await startConfigUiServer(options);
  return { url };
}
