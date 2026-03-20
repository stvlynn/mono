# ADR 0008: Add a Local Autonomy Heartbeat with Feedback-Driven Learning State

## Context

`mono` already had a task runtime, mutable task todos, and local-first structured memory, but it did not have a durable mechanism for:

- noticing unresolved work while idle
- resuming or enqueuing work without a fresh user turn
- recording whether autonomous behavior was helping or hurting

The project also needed these autonomy signals to remain locally inspectable and compatible with the existing task runtime.

## Decision

Add a local autonomy control loop on top of the current runtime:

- keep `Agent.runTask()` as the execution path for both user and autonomous work
- add a low-frequency heartbeat that evaluates open questions, stalled todos, and recent feedback
- store autonomy intents, feedback signals, and learning state under local `memory-v2`
- mark autonomous task origin in `TaskState`
- give autonomous tasks a bounded lease for wall time, tool calls, and step count
- expose heartbeat and feedback actions through runtime events instead of hidden background behavior

## Consequences

- autonomy remains debuggable through local files and runtime events
- existing task orchestration stays reusable instead of being replaced
- structured memory now carries both collaboration context and autonomy control state
- stronger autonomous behavior is possible without making OpenViking or SeekDB authoritative
- future multi-worker or daemon-based autonomy would require a separate decision
