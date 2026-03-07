import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { UIWaitingCopy, WaitingStateKind } from "./types/ui.js";

export interface WaitingCopyContext {
  goal?: string;
  toolName?: string;
}

const TEMPLATE_BY_KIND: Record<WaitingStateKind, string> = {
  assistant_start: "waiting_assistant_start.j2",
  assistant_reasoning: "waiting_assistant_reasoning.j2",
  assistant_streaming: "waiting_assistant_streaming.j2",
  tool_running: "waiting_tool_running.j2",
  task_planning: "waiting_task_planning.j2",
  task_verifying: "waiting_task_verifying.j2"
};

const FALLBACK_BY_KIND: Record<WaitingStateKind, string[]> = {
  assistant_start: ["正在支棱起来", "正在准备开工", "🐟正在热身"],
  assistant_reasoning: ["正在细品", "正在默默推演", "🐟正在动脑子"],
  assistant_streaming: ["正在敲键盘", "正在组织语言", "🐟正在往外倒思路"],
  tool_running: ["正在折腾工具", "正在盯着工具输出", "🐟正在围观工具干活"],
  task_planning: ["正在拆任务", "正在排执行路线", "🐟正在认真规划"],
  task_verifying: ["正在对答案", "正在翻证据", "🐟正在验收"]
};

interface WaitingTemplateVariables {
  emoji: string;
  prefix: string;
  action: string;
  suffix: string;
  tool_name?: string;
  before: string;
  after: string;
  goal?: string;
}

function getTemplateCandidates(fileName: string): string[] {
  return [
    fileURLToPath(new URL(`../../prompts/src/templates/ui/${fileName}`, import.meta.url)),
    fileURLToPath(new URL(`../../prompts/dist/templates/ui/${fileName}`, import.meta.url))
  ];
}

function loadTemplate(fileName: string): string {
  for (const candidate of getTemplateCandidates(fileName)) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }

  throw new Error(`Waiting copy template file not found: ${fileName}`);
}

function renderTemplate(template: string, context: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gu, (_match, variableName: string) => {
    const value = context[variableName];
    if (typeof value !== "string") {
      throw new Error(`Missing waiting copy template variable: ${variableName}`);
    }
    return value;
  });
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function buildWaitingVariables(kind: WaitingStateKind, context: WaitingCopyContext): WaitingTemplateVariables {
  const emoji = pickRandom(["", "", "🐟", "🧠", "⌛", "🪄"] as const);
  const suffix = pickRandom(["", "", "……", "。", "，稍等一下", "，别急"] as const);

  switch (kind) {
    case "assistant_start":
      return {
        emoji,
        prefix: pickRandom(["正在", "火速", "悄悄", "这边正在", "先"] as const),
        action: pickRandom(["支棱起来", "把脑子接上电源", "整理一下思路", "热启动大脑", "假装进入工作状态"] as const),
        suffix,
        tool_name: context.toolName,
        before: "",
        after: "",
        goal: context.goal
      };
    case "assistant_reasoning":
      return {
        emoji,
        prefix: pickRandom(["正在", "默默在", "认真在", "偷偷在", "火速在"] as const),
        action: pickRandom(["细品", "默默推演", "把线头一根根理出来", "脑内搭脚手架", "复盘前因后果"] as const),
        suffix,
        tool_name: context.toolName,
        before: "",
        after: "",
        goal: context.goal
      };
    case "assistant_streaming":
      return {
        emoji,
        prefix: pickRandom(["正在", "努力在", "火速在", "认真在", "表面上正在"] as const),
        action: pickRandom(["敲键盘", "往外倒思路", "把结论一个字一个字搬出来", "组织语言", "装作很会说"] as const),
        suffix,
        tool_name: context.toolName,
        before: "",
        after: "",
        goal: context.goal
      };
    case "tool_running":
      return {
        emoji,
        prefix: "",
        action: "",
        suffix,
        tool_name: context.toolName,
        before: pickRandom(["正在折腾", "正在催", "正在盯着", "正在让", "正在围观"] as const),
        after: pickRandom(["", "干活", "输出", "交作业", "表演"] as const),
        goal: context.goal
      };
    case "task_planning":
      return {
        emoji,
        prefix: pickRandom(["正在", "认真在", "火速在", "一边摸鱼一边", "表面上正在"] as const),
        action: pickRandom(["拆任务", "盘一盘怎么下手", "给活儿排先后顺序", "画执行路线", "假装很有条理地规划"] as const),
        suffix,
        tool_name: context.toolName,
        before: "",
        after: "",
        goal: context.goal
      };
    case "task_verifying":
      return {
        emoji,
        prefix: pickRandom(["正在", "认真在", "火速在", "默默在", "装作严谨地"] as const),
        action: pickRandom(["对答案", "查漏补缺", "翻证据", "确认是不是终于对了", "验收"] as const),
        suffix,
        tool_name: context.toolName,
        before: "",
        after: "",
        goal: context.goal
      };
  }
}

function fallbackMessage(kind: WaitingStateKind, context?: WaitingCopyContext): string {
  const selected = pickRandom(FALLBACK_BY_KIND[kind]);
  if (kind !== "tool_running" || !context?.toolName) {
    return selected;
  }

  return selected.replace("工具", context.toolName);
}

export function resolveWaitingCopy(kind: WaitingStateKind, context: WaitingCopyContext = {}): UIWaitingCopy {
  try {
    const rendered = renderTemplate(loadTemplate(TEMPLATE_BY_KIND[kind]), {
      ...buildWaitingVariables(kind, context)
    }).trim();
    if (!rendered) {
      throw new Error(`Waiting copy template produced an empty string: ${TEMPLATE_BY_KIND[kind]}`);
    }

    return {
      kind,
      message: rendered,
      ...(context.toolName ? { toolName: context.toolName } : {})
    };
  } catch {
    return {
      kind,
      message: fallbackMessage(kind, context),
      ...(context.toolName ? { toolName: context.toolName } : {})
    };
  }
}
