import { describe, expect, it } from "vitest";
import type { FeedbackSignal, LearningState, SelfRuntimeRecord, TaskResult, TaskState, TaskTodoRecord } from "../packages/shared/src/index.js";
import {
  applyFeedbackToLearningState,
  applyFeedbackToSelfRuntime,
  buildHeartbeatSelection,
  createAutonomyLease,
  diagnoseTaskOutcome,
  extractUserFeedbackSignals,
} from "../packages/agent-core/src/autonomy-runtime.js";

function createRuntime(): SelfRuntimeRecord {
  return {
    updatedAt: 0,
    currentGoals: [],
    activeProjects: [],
    currentTensions: [],
    taskHints: [],
    openQuestions: ["How should the failing test be fixed without regressing summaries?"],
    currentHypotheses: [],
    frictionPatterns: ["Verification keeps failing due to missing evidence."],
    autonomyPolicy: {
      enabled: true,
      heartbeatIntervalMs: 30_000,
      maxAutonomousTasksPerHour: 6,
      allowBroadExecution: true,
    },
    cooldowns: [],
  };
}

function createLearningState(): LearningState {
  return {
    updatedAt: 0,
    strategyStats: [],
    failurePatterns: [],
    userPreferenceBias: {},
    cooldowns: [],
  };
}

describe("autonomy runtime", () => {
  it("selects the highest-priority heartbeat candidate", () => {
    const todo: TaskTodoRecord = {
      id: "todo-1",
      taskId: "task-1",
      sessionId: "session-1",
      projectKey: "project",
      createdAt: 1,
      updatedAt: 1,
      goal: "Fix the failing test",
      todos: [{ id: "step-1", description: "Inspect the failure", status: "in_progress" }],
      status: "blocked",
      verificationMode: "strict",
    };

    const selection = buildHeartbeatSelection({
      now: 60_000,
      selfRuntime: createRuntime(),
      learningState: createLearningState(),
      todos: [todo],
      recentFeedback: [],
    });

    expect(selection.selectedIntent?.kind).toBe("resume_task");
    expect(selection.decision.decision).toBe("resume_task");
  });

  it("diagnoses missing verification evidence as an info gap", () => {
    const task: TaskState = {
      taskId: "task-1",
      goal: "Fix the failing test",
      phase: "summarize",
      attempts: 1,
      verification: {
        mode: "strict",
        evidence: [],
        passed: false,
        reason: "No strong verification evidence was collected.",
      },
      origin: "heartbeat",
      lease: createAutonomyLease(1),
    };
    const result: TaskResult = {
      taskId: "task-1",
      status: "incomplete",
      summary: "Verification was inconclusive.",
      turns: 1,
      verification: task.verification,
      messages: [],
    };

    const diagnosis = diagnoseTaskOutcome(task, result);

    expect(diagnosis?.code).toBe("info_gap");
    expect(diagnosis?.openQuestion).toContain("evidence");
  });

  it("updates learning state and runtime from negative feedback", () => {
    const task: TaskState = {
      taskId: "task-1",
      goal: "Fix the failing test",
      phase: "blocked",
      attempts: 2,
      verification: { mode: "strict", evidence: [], passed: false },
      origin: "heartbeat",
      lease: createAutonomyLease(1),
    };
    const diagnosis = diagnoseTaskOutcome(task, {
      taskId: "task-1",
      status: "blocked",
      summary: "Blocked after repeated failures.",
      turns: 2,
      verification: task.verification,
      messages: [],
    })!;
    const feedback: FeedbackSignal[] = [
      {
        id: "fb-1",
        createdAt: 10,
        source: "task",
        kind: "task_blocked",
        target: "fix_the_failing_test",
        valence: "negative",
        strength: 0.8,
        summary: "Blocked after repeated failures.",
      },
    ];

    const nextLearning = applyFeedbackToLearningState(createLearningState(), feedback, task, diagnosis, 10);
    const nextRuntime = applyFeedbackToSelfRuntime(createRuntime(), feedback, diagnosis, 10);

    expect(nextLearning.strategyStats[0]?.failureCount).toBe(1);
    expect(nextLearning.cooldowns.length).toBeGreaterThan(0);
    expect(nextRuntime.openQuestions.some((item) => item.includes("unblock"))).toBe(true);
    expect(nextRuntime.frictionPatterns).toContain("Blocked after repeated failures.");
  });

  it("extracts explicit user correction and acceptance feedback signals", () => {
    const rejection = extractUserFeedbackSignals("不对，这不是我要的结果。");
    const acceptance = extractUserFeedbackSignals("对，就是这个。谢谢。");

    expect(rejection[0]?.kind).toBe("correction");
    expect(rejection[0]?.valence).toBe("negative");
    expect(acceptance[0]?.kind).toBe("acceptance");
    expect(acceptance[0]?.valence).toBe("positive");
  });

  it("applies explicit user correction to autonomy bias", () => {
    const task: TaskState = {
      taskId: "task-1",
      goal: "Summarize the changes",
      phase: "done",
      attempts: 1,
      verification: { mode: "none", evidence: [], passed: true },
      origin: "user",
    };
    const signals = extractUserFeedbackSignals("不对，这不是我要的结果。");

    const nextLearning = applyFeedbackToLearningState(createLearningState(), signals, task, null, 20);

    expect(nextLearning.userPreferenceBias.autonomy_execution).toBeLessThan(0);
  });

  it("suppresses heartbeat work when recent autonomy feedback is strongly negative", () => {
    const todo: TaskTodoRecord = {
      id: "todo-1",
      taskId: "task-1",
      sessionId: "session-1",
      projectKey: "project",
      createdAt: 1,
      updatedAt: 1,
      goal: "Fix the failing test",
      todos: [{ id: "step-1", description: "Inspect the failure", status: "in_progress" }],
      status: "blocked",
      verificationMode: "strict",
    };

    const selection = buildHeartbeatSelection({
      now: 60_000,
      selfRuntime: createRuntime(),
      learningState: {
        ...createLearningState(),
        userPreferenceBias: {
          autonomy_execution: -0.8,
        },
      },
      todos: [todo],
      recentFeedback: [],
    });

    expect(selection.selectedIntent).toBeUndefined();
    expect(selection.decision.decision).toBe("noop");
  });

  it("requests confirmation for medium-risk work when broad execution is disabled", () => {
    const todo: TaskTodoRecord = {
      id: "todo-1",
      taskId: "task-1",
      sessionId: "session-1",
      projectKey: "project",
      createdAt: 1,
      updatedAt: 1,
      goal: "Fix the failing test",
      todos: [{ id: "step-1", description: "Inspect the failure", status: "in_progress" }],
      status: "blocked",
      verificationMode: "strict",
    };

    const selection = buildHeartbeatSelection({
      now: 60_000,
      selfRuntime: {
        ...createRuntime(),
        autonomyPolicy: {
          ...createRuntime().autonomyPolicy,
          allowBroadExecution: false,
        },
      },
      learningState: createLearningState(),
      todos: [todo],
      recentFeedback: [],
    });

    expect(selection.selectedIntent?.recommendedAction).toBe("request_user_confirmation");
    expect(selection.decision.decision).toBe("request_user_confirmation");
  });
});
