import type { AgentTool } from "@mono/shared";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { DefaultPermissionPolicy, wrapToolWithPermissions, type WrappedToolOptions } from "./permission.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export * from "./bash.js";
export * from "./edit.js";
export * from "./permission.js";
export * from "./read.js";
export * from "./utils.js";
export * from "./write.js";

export function createCodingTools(cwd: string): AgentTool[] {
  return [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd)];
}

export function createProtectedCodingTools(cwd: string, options: Omit<WrappedToolOptions, "cwd" | "policy"> & { policy?: WrappedToolOptions["policy"] }): AgentTool[] {
  const policy = options.policy ?? new DefaultPermissionPolicy();
  return createCodingTools(cwd).map((tool) =>
    wrapToolWithPermissions(tool, {
      ...options,
      cwd,
      policy
    })
  );
}
