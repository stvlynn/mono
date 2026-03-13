import { stdout as output } from "node:process";
import { Command } from "commander";
import { formatContextPreview, formatMemoryRecord, writeJson, writeLine } from "../output.js";
import {
  runMemoryList,
  runMemoryRecall,
  runMemorySearch,
  runMemoryShow,
  runMemoryStatus
} from "../use-cases/memory-core.js";
import {
  runExportOpenViking,
  runMemoryCompareOpenViking,
  runOpenVikingStatus
} from "../use-cases/memory-openviking.js";
import {
  runExportSeekDb,
  runMemoryCompareSeekDb,
  runMirrorSessionSeekDb,
  runSeekDbStatus
} from "../use-cases/memory-seekdb.js";

export function registerMemoryCommands(program: Command): void {
  const memory = program.command("memory").description("Inspect and manage project memory");

  memory
    .command("status")
    .description("Show memory configuration and store status")
    .action(async () => {
      const payload = await runMemoryStatus();
      output.write(`Enabled: ${payload.enabled}\n`);
      output.write(`Auto inject: ${payload.autoInject}\n`);
      output.write(`Retrieval backend: ${payload.retrievalBackend}\n`);
      output.write(`Fallback to local: ${payload.fallbackToLocal}\n`);
      output.write(`Store path: ${payload.storePath}\n`);
      output.write(`OpenViking: ${payload.openViking}\n`);
      output.write(`SeekDB: ${payload.seekDb}\n`);
      output.write(`Records: ${payload.records}\n`);
      output.write(`Current session: ${payload.currentSession}\n`);
      output.write(`Last memory: ${payload.lastMemory}\n`);
    });

  memory
    .command("list")
    .description("List recent memory records")
    .option("-n, --limit <limit>", "number of records to show", "10")
    .action(async (options) => {
      const records = await runMemoryList(Number(options.limit));
      if (records.length === 0) {
        writeLine("No memory records found.");
        return;
      }
      for (const record of records) {
        writeLine(formatMemoryRecord(record));
      }
    });

  memory
    .command("search")
    .description("Search memory records by keyword")
    .argument("<query>", "keyword query")
    .action(async (query: string) => {
      const matches = await runMemorySearch(query);
      if (matches.length === 0) {
        writeLine("No matching memory records.");
        return;
      }
      for (const match of matches) {
        output.write(`${match.id}\n`);
        for (const line of match.matchedLines) {
          output.write(`  [${line.line}] ${line.text}\n`);
        }
      }
    });

  memory
    .command("show")
    .description("Show one memory record")
    .argument("<id>", "memory id")
    .action(async (id: string) => {
      const record = await runMemoryShow(id);
      writeLine(formatMemoryRecord(record));
      if (record.referencedMemoryIds.length > 0) {
        writeLine(`  referenced: ${record.referencedMemoryIds.join(", ")}`);
      }
    });

  memory
    .command("recall")
    .description("Preview memory recall for the current session")
    .argument("[query]", "optional keyword query")
    .action(async (query?: string) => {
      const payload = await runMemoryRecall(query);
      writeJson(payload.plan);
      for (const record of payload.records) {
        writeLine(formatMemoryRecord(record));
      }
    });

  memory
    .command("compare")
    .description("Compare local execution-memory recall with OpenViking retrieval")
    .argument("<query>", "query to evaluate against both systems")
    .option("--json", "output JSON")
    .action(async (query: string, options) => {
      const payload = await runMemoryCompareOpenViking(query);
      if (options.json) {
        writeJson(payload);
        return;
      }
      output.write(`Query: ${payload.query}\n`);
      output.write(`Local selected: ${payload.local.selectedIds.length}\n`);
      output.write(`OpenViking selected: ${payload.openViking.items.length}\n`);
      writeLine(formatContextPreview("Local context", payload.local.contextBlock ? payload.local.contextBlock.split("\n") : []));
      writeLine(formatContextPreview("OpenViking context", payload.openViking.contextBlock ? payload.openViking.contextBlock.split("\n") : []));
    });

  memory
    .command("openviking-status")
    .description("Check OpenViking connectivity with the current memory config")
    .action(async () => {
      writeJson(await runOpenVikingStatus());
    });

  memory
    .command("export-openviking")
    .description("Shadow-export a local execution memory record into OpenViking via session extraction")
    .argument("[id]", "memory record id; defaults to the latest local memory record")
    .action(async (id?: string) => {
      writeJson(await runExportOpenViking(id));
    });

  memory
    .command("seekdb-status")
    .description("Check SeekDB connectivity and show execution-memory/session mirror stats")
    .action(async () => {
      writeJson(await runSeekDbStatus());
    });

  memory
    .command("compare-seekdb")
    .description("Compare local execution-memory recall with SeekDB-backed retrieval")
    .argument("<query>", "query to evaluate against both systems")
    .option("--json", "output JSON")
    .action(async (query: string, options) => {
      const payload = await runMemoryCompareSeekDb(query);
      if (options.json) {
        writeJson(payload);
        return;
      }
      output.write(`Query: ${payload.query}\n`);
      output.write(`Local selected: ${payload.local.selectedIds.length}\n`);
      output.write(`SeekDB selected: ${payload.seekDb.items.length}\n`);
      writeLine(formatContextPreview("Local context", payload.local.contextBlock ? payload.local.contextBlock.split("\n") : []));
      writeLine(formatContextPreview("SeekDB context", payload.seekDb.contextBlock ? payload.seekDb.contextBlock.split("\n") : []));
    });

  memory
    .command("export-seekdb")
    .description("Export a local execution memory record into SeekDB execution memory storage")
    .argument("[id]", "memory record id; defaults to the latest local memory record")
    .action(async (id?: string) => {
      writeJson(await runExportSeekDb(id));
    });

  memory
    .command("mirror-session-seekdb")
    .description("Mirror one local session JSONL stream into SeekDB for evaluation")
    .argument("[sessionId]", "session id; defaults to the current session")
    .action(async (sessionId?: string) => {
      writeJson(await runMirrorSessionSeekDb(sessionId));
    });
}
