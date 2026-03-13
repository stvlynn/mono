import { Box, Text } from "ink";
import type { AssistantMessage, ConversationMessage, ToolCallPart, ToolResultMessage, UserMessage } from "@mono/shared";
import type { ReactNode } from "react";
import { useSettings } from "../contexts/SettingsContext.js";
import { summarizeToolContent, summarizeToolInput, summarizeToolResultDetail } from "../tool-display.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

function MessageCard({
  title,
  color,
  children
}: {
  title: string;
  color: "green" | "cyan" | "yellow" | "red" | "gray";
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={1}>
      <Text bold color={color}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function UserMessageDisplay({ message }: { message: UserMessage }) {
  const content = typeof message.content === "string"
    ? message.content
    : message.content
      .map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`))
      .join("\n");

  return (
    <MessageCard title="You" color="green">
      <Text>{content || "[attachments]"}</Text>
    </MessageCard>
  );
}

function ToolCallDisplay({ part }: { part: ToolCallPart }) {
  const { settings } = useSettings();
  const detail = JSON.stringify(part.arguments, null, 2);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>
        Tool Call
      </Text>
      <Text>{part.name} · {summarizeToolInput(part.arguments)}</Text>
      {settings.toolDetailsVisible ? <Text dimColor>{detail}</Text> : null}
    </Box>
  );
}

function ThinkingDisplay({ thinking }: { thinking: string }) {
  const { settings } = useSettings();

  if (!settings.thinkingVisible) {
    return (
      <Box marginTop={1}>
        <Text dimColor>Thinking hidden · {thinking.length} chars</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text dimColor bold>
        Thinking
      </Text>
      <Text dimColor>{thinking}</Text>
    </Box>
  );
}

function AssistantMessageDisplay({ message }: { message: AssistantMessage }) {
  const { settings } = useSettings();
  const thinkingParts = message.content.filter((part) => part.type === "thinking");
  const textParts = message.content.filter((part) => part.type === "text");
  const toolCalls = message.content.filter((part): part is ToolCallPart => part.type === "tool-call");

  return (
    <MessageCard title="Assistant" color="cyan">
      {thinkingParts.map((part, index) => (
        <ThinkingDisplay key={`thinking-${index}`} thinking={part.thinking} />
      ))}
      {textParts.map((part, index) => (
        <Box key={`text-${index}`} marginTop={index === 0 && thinkingParts.length === 0 ? 0 : 1}>
          <MarkdownRenderer content={part.text} enabled={settings.assistantMarkdownEnabled} />
        </Box>
      ))}
      {toolCalls.map((part) => (
        <ToolCallDisplay key={part.id} part={part} />
      ))}
      {thinkingParts.length === 0 && textParts.length === 0 && toolCalls.length === 0 ? (
        <Text dimColor>No visible assistant output.</Text>
      ) : null}
    </MessageCard>
  );
}

function ToolMessageDisplay({ message }: { message: ToolResultMessage }) {
  const { settings } = useSettings();
  const summary = summarizeToolContent(message.content);
  const detail = summarizeToolResultDetail(message.content);

  return (
    <MessageCard title={`Tool · ${message.toolName}`} color={message.isError ? "red" : "yellow"}>
      <Text color={message.isError ? "red" : "yellow"}>
        {message.isError ? "Failed" : "Completed"} · {summary}
      </Text>
      {settings.toolDetailsVisible && detail ? (
        <Box marginTop={1}>
          <Text dimColor>{detail}</Text>
        </Box>
      ) : null}
    </MessageCard>
  );
}

export function ConversationMessageDisplay({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return <UserMessageDisplay message={message} />;
  }

  if (message.role === "tool") {
    return <ToolMessageDisplay message={message} />;
  }

  return <AssistantMessageDisplay message={message} />;
}
