import { Box, Text } from "ink";
import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdownToBlocks, type MarkdownBlockNode, type MarkdownInlineNode } from "../markdown.js";

function renderInlineNodes(nodes: MarkdownInlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.text}</Fragment>;
      case "strong":
        return (
          <Text key={key} bold>
            {renderInlineNodes(node.children, `${key}-strong`)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} italic>
            {renderInlineNodes(node.children, `${key}-em`)}
          </Text>
        );
      case "del":
        return (
          <Text key={key} strikethrough>
            {renderInlineNodes(node.children, `${key}-del`)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={key} color="yellow">
            `{node.text}`
          </Text>
        );
      case "link":
        return (
          <Text key={key} color="cyan">
            {renderInlineNodes(node.children, `${key}-link`)}
            {node.href ? ` (${node.href})` : ""}
          </Text>
        );
      case "linebreak":
        return (
          <Fragment key={key}>
            {"\n"}
          </Fragment>
        );
      default:
        return null;
    }
  });
}

function renderListItem(item: Extract<MarkdownBlockNode, { type: "list" }>["items"][number], index: number, ordered: boolean): ReactNode {
  const marker = item.checked === true
    ? "[x]"
    : item.checked === false
      ? "[ ]"
      : ordered
        ? `${index + 1}.`
        : "•";

  return (
    <Box key={`item-${index}`} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Box width={4}>
          <Text color="magenta">{marker}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {item.children.map((child, childIndex) => renderBlockNode(child, `item-${index}-${childIndex}`))}
        </Box>
      </Box>
    </Box>
  );
}

function renderBlockNode(block: MarkdownBlockNode, key: string): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <Box key={key} marginBottom={1}>
          <Text>{renderInlineNodes(block.children, `${key}-paragraph`)}</Text>
        </Box>
      );
    case "heading": {
      const color = block.depth <= 2 ? "cyan" : block.depth === 3 ? "green" : "white";
      return (
        <Box key={key} marginBottom={1}>
          <Text bold color={color}>
            {renderInlineNodes(block.children, `${key}-heading`)}
          </Text>
        </Box>
      );
    }
    case "code":
      return (
        <Box key={key} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
          {block.lang ? (
            <Text dimColor>{block.lang}</Text>
          ) : null}
          <Text>{block.text}</Text>
        </Box>
      );
    case "blockquote":
      return (
        <Box key={key} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
          {block.children.map((child, index) => renderBlockNode(child, `${key}-quote-${index}`))}
        </Box>
      );
    case "list":
      return (
        <Box key={key} flexDirection="column" marginBottom={1}>
          {block.items.map((item, index) => renderListItem(item, index, block.ordered))}
        </Box>
      );
    case "hr":
      return (
        <Box key={key} marginBottom={1}>
          <Text dimColor>────────────────────</Text>
        </Box>
      );
    default:
      return null;
  }
}

function PlainTextRenderer({ content }: { content: string }) {
  return (
    <Box flexDirection="column">
      {content.split("\n").map((line, index) => (
        <Text key={`plain-${index}`}>{line}</Text>
      ))}
    </Box>
  );
}

export function MarkdownRenderer({
  content,
  enabled = true
}: {
  content: string;
  enabled?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdownToBlocks(content), [content]);

  if (!enabled || blocks.length === 0) {
    return <PlainTextRenderer content={content} />;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => renderBlockNode(block, `block-${index}`))}
    </Box>
  );
}
