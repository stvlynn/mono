import { Box, Text } from "ink";
import { useUIState } from "../contexts/UIStateContext.js";

export function TodoTray() {
  const { currentTask, currentTodoRecord } = useUIState();
  if (!currentTask) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="green">
        Task
      </Text>
      {!currentTodoRecord || currentTodoRecord.todos.length === 0 ? (
        <Text dimColor>No active todo list. The model can create one with write_todos.</Text>
      ) : currentTodoRecord.todos.map((todo) => {
        const marker =
          todo.status === "completed"
            ? "[x]"
            : todo.status === "in_progress"
              ? "[>]"
              : todo.status === "cancelled"
                ? "[-]"
                : "[ ]";
        return (
          <Text key={todo.id} dimColor={todo.status === "pending"}>
            {marker} {todo.description}
          </Text>
        );
      })}
    </Box>
  );
}
