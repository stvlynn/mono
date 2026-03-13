import type { BootstrapFileReport, ContextAssemblyReport } from "@mono/shared";

export function formatContextReportLines(report: ContextAssemblyReport, detailed = false): string[] {
  const lines = [
    `Context total: ${report.totalChars} chars (~${report.estimatedTokens} tok)`,
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Workspace: ${report.cwd}`,
    "",
    "Sections:"
  ];

  for (const section of report.sections) {
    lines.push(`- ${section.title}: ${section.chars} chars (~${section.estimatedTokens} tok)`);
  }

  lines.push("");
  lines.push("Memory:");
  lines.push(`- enabled: ${report.memory.enabled}`);
  lines.push(`- auto inject: ${report.memory.autoInject}`);
  lines.push(`- backend: ${report.memory.backend}`);
  lines.push(`- retrieved ids: ${report.memory.retrievedMemoryIds.length > 0 ? report.memory.retrievedMemoryIds.join(", ") : "<none>"}`);
  lines.push(`- retrieved chars: ${report.memory.retrievedChars}`);
  lines.push(`- bootstrap memory: ${report.memory.bootstrapMemoryIncluded ? report.memory.bootstrapMemoryPath ?? "<unknown>" : "<not included>"}`);

  lines.push("");
  lines.push("Bootstrap:");
  if (report.bootstrapFiles.length === 0) {
    lines.push("- <none>");
    return lines;
  }

  for (const item of report.bootstrapFiles) {
    lines.push(formatBootstrapSummary(item, detailed));
  }

  return lines;
}

function formatBootstrapSummary(item: BootstrapFileReport, detailed: boolean): string {
  const summary = `- ${item.path}: ${item.status}`;
  if (!detailed) {
    return summary;
  }
  return `${summary} | raw=${item.rawChars} injected=${item.injectedChars}`;
}
