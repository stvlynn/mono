import { createHash } from "node:crypto";
import type {
  AssistantMessage,
  ConversationMessage,
  RuntimeEvent,
  SessionCompressionResult,
  TaskItem,
  TaskPhase,
  TaskResult,
  TaskState,
  UnifiedModel,
  VerificationMode,
  VerificationState
} from "@mono/shared";

export interface TaskRuntimeOptions {
  goal: string;
  model: UnifiedModel;
  existingMessages: ConversationMessage[];
  maxTurns?: number;
}

export interface TurnRuntimePlan {
  phase: Extract<TaskPhase, "execute" | "verify">;
  prompt: string;
}

export interface CompletedTurnContext {
  task: TaskState;
  turnMessages: ConversationMessage[];
}

export interface VerificationOutcome {
  passed: boolean;
  reason: string;
  evidence: string[];
}

export function createTaskState(options: TaskRuntimeOptions): TaskState {
  const verificationMode = inferVerificationMode(options.goal);
  const todos: TaskItem[] = [
    createTaskItem("understand-request", "Understand the goal and constraints", "completed"),
    createTaskItem("execute", "Execute the required work", "in_progress"),
    createTaskItem("verify", "Verify the result", verificationMode === "none" ? "cancelled" : "pending"),
    createTaskItem("summarize", "Summarize the outcome", "pending")
  ];

  return {
    taskId: createTaskId(options.goal),
    goal: options.goal,
    phase: "plan",
    todos,
    attempts: 0,
    verification: {
      mode: verificationMode,
      evidence: []
    }
  };
}

export function applyVerificationMode(task: TaskState, mode: VerificationMode): TaskState {
  const next = cloneTask(task);
  next.verification.mode = mode;
  const verifyTodo = next.todos.find((todo) => todo.id === "verify");
  if (verifyTodo) {
    verifyTodo.status = mode === "none" ? "cancelled" : verifyTodo.status === "cancelled" ? "pending" : verifyTodo.status;
  }
  return next;
}

export function advanceTaskPhase(task: TaskState, phase: TaskPhase): TaskState {
  const next = cloneTask(task);
  next.phase = phase;

  if (phase === "execute") {
    setTodoStatus(next.todos, "execute", "in_progress");
  }

  if (phase === "verify") {
    setTodoStatus(next.todos, "execute", "completed");
    setTodoStatus(next.todos, "verify", "in_progress");
  }

  if (phase === "summarize") {
    if (next.verification.mode !== "none") {
      setTodoStatus(next.todos, "verify", next.verification.passed ? "completed" : next.todos.find((todo) => todo.id === "verify")?.status ?? "completed");
    }
    setTodoStatus(next.todos, "summarize", "in_progress");
  }

  if (phase === "done" || phase === "blocked" || phase === "incomplete" || phase === "aborted") {
    setTodoStatus(next.todos, "execute", "completed");
    if (next.verification.mode !== "none" && next.verification.passed) {
      setTodoStatus(next.todos, "verify", "completed");
    }
    if (phase === "blocked" && next.verification.mode !== "none" && next.todos.find((todo) => todo.id === "verify")?.status === "in_progress") {
      setTodoStatus(next.todos, "verify", "cancelled");
    }
    if (phase === "incomplete" && next.verification.mode !== "none" && next.todos.find((todo) => todo.id === "verify")?.status === "in_progress") {
      setTodoStatus(next.todos, "verify", "pending");
    }
    setTodoStatus(next.todos, "summarize", phase === "aborted" ? "cancelled" : "completed");
  }

  return next;
}

export function buildTaskTurnPlan(task: TaskState): TurnRuntimePlan {
  if (task.phase === "verify") {
    return {
      phase: "verify",
      prompt: [
        "You are in verification mode.",
        `Goal: ${task.goal}`,
        "Verify whether the requested work is complete.",
        "Prefer targeted checks over more edits.",
        "Use read or bash tools if you need evidence.",
        "If verification fails, explain precisely what is still wrong."
      ].join("\n")
    };
  }

  return {
    phase: "execute",
    prompt: [
      "You are in execution mode.",
      `Goal: ${task.goal}`,
      currentTaskLine(task),
      "Make progress on the active task item.",
      "If code or files changed, leave enough evidence for a later verification pass."
    ].join("\n")
  };
}

export function updateTaskAfterTurn(context: CompletedTurnContext): {
  task: TaskState;
  verification?: VerificationOutcome;
  loopDetected: boolean;
  nextPhase: TaskPhase;
} {
  const next = cloneTask(context.task);
  next.attempts += 1;

  const loopDetected = detectLoop(context.turnMessages);
  if (loopDetected) {
    return {
      task: next,
      loopDetected,
      nextPhase: "blocked"
    };
  }

  if (context.task.phase === "verify") {
    const verification = evaluateVerification(context.turnMessages, next.verification.mode);
    next.verification = {
      ...next.verification,
      passed: verification.passed,
      reason: verification.reason,
      evidence: verification.evidence,
      lastCheckedAt: Date.now()
    };
    return {
      task: next,
      verification,
      loopDetected,
      nextPhase: verification.passed ? "summarize" : "execute"
    };
  }

  if (next.verification.mode === "none") {
    return {
      task: next,
      loopDetected,
      nextPhase: "summarize"
    };
  }

  return {
    task: next,
    loopDetected,
    nextPhase: "verify"
  };
}

export function buildTaskSummary(task: TaskState, messages: ConversationMessage[], status?: TaskResult["status"]): string {
  const assistantMessages = messages.filter((message): message is AssistantMessage => message.role === "assistant");
  const assistantText = assistantMessages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);
  const latestAssistant = assistantText.at(-1);
  const verificationLine =
    task.verification.mode === "none"
      ? "Verification was not required."
      : task.verification.passed
        ? `Verification passed: ${task.verification.reason ?? "sufficient evidence collected."}`
        : `Verification status: ${task.verification.reason ?? "not confirmed."}`;
  const statusLabel = status ?? (task.verification.passed ? "done" : "incomplete");
  return [
    `Task status: ${statusLabel}.`,
    latestAssistant ? `Latest outcome: ${latestAssistant}` : "No assistant summary was produced.",
    verificationLine
  ].join(" ");
}

export function shouldCompressMessages(messages: ConversationMessage[], threshold = 14): boolean {
  return messages.length > threshold;
}

export function compressConversation(messages: ConversationMessage[], model: UnifiedModel, preserveRecentMessages = 8): {
  messages: ConversationMessage[];
  result: SessionCompressionResult;
} {
  if (messages.length <= preserveRecentMessages + 2) {
    return {
      messages,
      result: {
        summary: "",
        preservedRecentMessages: preserveRecentMessages,
        replacedMessageCount: 0,
        tokenEstimateBefore: estimateTokenCount(messages),
        tokenEstimateAfter: estimateTokenCount(messages)
      }
    };
  }

  const preserved = messages.slice(-preserveRecentMessages);
  const replaced = messages.slice(0, -preserveRecentMessages);
  const summary = summarizeMessages(replaced);
  const syntheticSummary: AssistantMessage = {
    role: "assistant",
    provider: "mono",
    model: `${model.provider}/${model.modelId}`,
    stopReason: "stop",
    timestamp: Date.now(),
    content: [{ type: "text", text: `[session summary]\n${summary}` }]
  };
  const compressedMessages = [syntheticSummary, ...preserved];
  return {
    messages: compressedMessages,
    result: {
      summary,
      preservedRecentMessages: preserveRecentMessages,
      replacedMessageCount: replaced.length,
      tokenEstimateBefore: estimateTokenCount(messages),
      tokenEstimateAfter: estimateTokenCount(compressedMessages)
    }
  };
}

export function buildTaskContext(task: TaskState): string {
  const todoLines = task.todos
    .map((todo) => `- [${todo.status}] ${todo.description}`)
    .join("\n");
  const verificationLine =
    task.verification.mode === "none"
      ? "Verification: not required"
      : `Verification: ${task.verification.passed ? "passed" : task.verification.reason ?? "pending"}`;
  return [
    "<TaskContext>",
    `Goal: ${task.goal}`,
    `Phase: ${task.phase}`,
    `Attempts: ${task.attempts}`,
    verificationLine,
    "Todos:",
    todoLines,
    "</TaskContext>"
  ].join("\n");
}

function currentTaskLine(task: TaskState): string {
  const current = task.todos.find((todo) => todo.status === "in_progress");
  return current ? `Current task: ${current.description}` : "Current task: progress the overall goal.";
}

function detectLoop(messages: ConversationMessage[]): boolean {
  const toolNames = messages
    .filter((message) => message.role === "tool")
    .map((message) => message.toolName);
  if (toolNames.length >= 3) {
    const recent = toolNames.slice(-3);
    if (new Set(recent).size === 1) {
      return true;
    }
  }

  const assistantText = messages
    .filter((message): message is AssistantMessage => message.role === "assistant")
    .map((message) =>
      message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text.trim())
        .join(" ")
    )
    .filter(Boolean);
  if (assistantText.length >= 2 && assistantText.at(-1) === assistantText.at(-2)) {
    return true;
  }

  return false;
}

function evaluateVerification(messages: ConversationMessage[], mode: VerificationMode): VerificationOutcome {
  if (mode === "none") {
    return {
      passed: true,
      reason: "Verification disabled",
      evidence: []
    };
  }

  const evidence = messages
    .filter((message) => message.role === "tool")
    .map((message) => {
      const content = typeof message.content === "string" ? message.content : "";
      return `${message.toolName}: ${content.slice(0, 160)}`;
    })
    .filter(Boolean);
  const haystack = evidence.join("\n").toLowerCase();
  const normalizedHaystack = haystack
    .replace(/\b0 failed\b/g, "zero_failed")
    .replace(/\b0 errors\b/g, "zero_errors")
    .replace(/\bexit code 0\b/g, "exit_code_zero");
  const hasSuccessSignal =
    /\b(pass|passed|success|succeeded|zero_failed|zero_errors|exit_code_zero|completed successfully)\b/.test(
      normalizedHaystack
    );
  const hasFailureSignal =
    /\b(fail|failed|error|errors|exception|not found|exit code [1-9])\b/.test(normalizedHaystack);

  if (hasSuccessSignal && !hasFailureSignal) {
    return {
      passed: true,
      reason: "Tool output indicates the requested work was verified successfully.",
      evidence
    };
  }

  return {
    passed: false,
    reason: hasFailureSignal
      ? "Verification found failing evidence in tool output."
      : "No strong verification evidence was collected.",
    evidence
  };
}

function summarizeMessages(messages: ConversationMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === "user") {
        return `User: ${typeof message.content === "string" ? message.content : "[attachments]"}`;
      }
      if (message.role === "tool") {
        return `Tool ${message.toolName}: ${typeof message.content === "string" ? message.content.slice(0, 120) : "[binary]"}`;
      }
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .slice(0, 180);
      const toolCalls = message.content
        .filter((part) => part.type === "tool-call")
        .map((part) => part.name)
        .join(", ");
      if (text) {
        return `Assistant: ${text}`;
      }
      if (toolCalls) {
        return `Assistant called tools: ${toolCalls}`;
      }
      return "Assistant";
    })
    .join("\n");
}

function estimateTokenCount(messages: ConversationMessage[]): number {
  const text = messages
    .map((message) => JSON.stringify(message))
    .join("\n");
  return Math.ceil(text.length / 4);
}

function inferVerificationMode(goal: string): VerificationMode {
  if (/\b(explain|summari[sz]e|review|analy[sz]e|inspect|understand|what|why|how)\b/i.test(goal)) {
    return "none";
  }

  if (/\b(test|verify|validate|fix|implement|edit|write|refactor|change|update)\b/i.test(goal)) {
    return "strict";
  }

  return "light";
}

function createTaskId(goal: string): string {
  return createHash("sha1").update(`${Date.now()}:${goal}`).digest("hex").slice(0, 12);
}

function createTaskItem(id: string, description: string, status: TaskItem["status"]): TaskItem {
  return { id, description, status };
}

function setTodoStatus(todos: TaskItem[], id: string, status: TaskItem["status"]): void {
  const todo = todos.find((item) => item.id === id);
  if (todo) {
    todo.status = status;
  }
}

function cloneTask(task: TaskState): TaskState {
  return {
    ...task,
    todos: task.todos.map((todo) => ({ ...todo })),
    verification: {
      ...task.verification,
      evidence: [...task.verification.evidence]
    }
  };
}
