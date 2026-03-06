import { Box, Text } from "ink";
import { useUIState } from "../contexts/UIStateContext.js";

export function ToastDisplay() {
  const { toasts } = useUIState();
  if (toasts.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {toasts.slice(-2).map((toast) => (
        <Text key={toast.id} color={toast.level === "error" ? "red" : toast.level === "warning" ? "yellow" : toast.level === "success" ? "green" : "cyan"}>
          {toast.message}
        </Text>
      ))}
    </Box>
  );
}
