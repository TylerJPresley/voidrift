import React from "react";
import { Text, Box } from "ink";

type LineType = "text" | "header" | "code_start" | "code_line" | "code_end" | "list_item" | "table_row" | "table_sep" | "hr" | "blank";

interface MarkdownLine {
  type: LineType;
  content: string;
  level?: number;
  lang?: string;
  cells?: string[];
}

export function parseMarkdownLines(text: string): MarkdownLine[] {
  const lines = text.split("\n");
  const result: MarkdownLine[] = [];
  let inCode = false;

  for (const line of lines) {
    if (!inCode && line.match(/^```(\w*)\s*$/)) {
      inCode = true;
      result.push({ type: "code_start", content: "", lang: RegExp.$1 });
    } else if (inCode && line.trim() === "```") {
      inCode = false;
      result.push({ type: "code_end", content: "" });
    } else if (inCode) {
      result.push({ type: "code_line", content: line });
    } else if (line.match(/^(#{1,4})\s+(.+)$/)) {
      result.push({ type: "header", content: RegExp.$2, level: RegExp.$1.length });
    } else if (line.match(/^\s*([-*_]\s*){3,}\s*$/)) {
      result.push({ type: "hr", content: "" });
    } else if (line.match(/^\|[\s:]*-+[\s:|-]*\|?\s*$/)) {
      result.push({ type: "table_sep", content: line });
    } else if (line.match(/^\|(.+)\|\s*$/)) {
      const cells = line.slice(1, -1).split("|").map(c => c.trim());
      result.push({ type: "table_row", content: line, cells });
    } else if (line.match(/^(\s*)[-*]\s+(.+)$/)) {
      result.push({ type: "list_item", content: RegExp.$2, level: Math.floor(RegExp.$1.length / 2) });
    } else if (line.match(/^(\s*)\d+\.\s+(.+)$/)) {
      result.push({ type: "list_item", content: RegExp.$2, level: Math.floor(RegExp.$1.length / 2) });
    } else if (line.trim() === "") {
      result.push({ type: "blank", content: "" });
    } else {
      result.push({ type: "text", content: line });
    }
  }
  return result;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Text key={key++}>{text.slice(lastIndex, match.index)}</Text>);
    }
    if (match[2]) {
      nodes.push(<Text key={key++} bold>{match[2]}</Text>);
    } else if (match[3]) {
      nodes.push(<Text key={key++} italic>{match[3]}</Text>);
    } else if (match[4]) {
      nodes.push(<Text key={key++} color="#e5c07b">{match[4]}</Text>);
    } else if (match[5]) {
      nodes.push(<Text key={key++} color="#61afef" underline>{match[5]}</Text>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Text key={key++}>{text.slice(lastIndex)}</Text>);
  }
  return nodes.length > 0 ? nodes : [<Text key={0}>{text}</Text>];
}

function TableRow({ cells, header }: { cells: string[]; header?: boolean }) {
  // Pad cells to consistent width
  return (
    <Box>
      {cells.map((cell, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text dimColor> │ </Text>}
          {header
            ? <Text bold>{renderInline(cell)}</Text>
            : <Text>{renderInline(cell)}</Text>
          }
        </React.Fragment>
      ))}
    </Box>
  );
}

export function MarkdownText({ text }: { text: string }) {
  const lines = parseMarkdownLines(text);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        switch (line.type) {
          case "header":
            return <Text key={i} bold color="#4ec9b0">{renderInline(line.content)}</Text>;
          case "code_start":
            return <Box key={i} marginTop={1}><Text dimColor>{'┌─'}{line.lang ? ` ${line.lang} ` : ""}{'─'.repeat(Math.max(0, 36 - (line.lang?.length || 0)))}</Text></Box>;
          case "code_line":
            return <Text key={i} color="#abb2bf">{'│ '}{line.content}</Text>;
          case "code_end":
            return <Box key={i} marginBottom={1}><Text dimColor>{'└─'.padEnd(40, '─')}</Text></Box>;
          case "list_item":
            return <Text key={i}>{"  ".repeat(line.level || 0)}  • {renderInline(line.content)}</Text>;
          case "table_sep":
            return <Text key={i} dimColor>  {'─'.repeat(40)}</Text>;
          case "table_row": {
            const isHeader = i === 0 || lines[i + 1]?.type === "table_sep";
            return <Box key={i} marginLeft={1}><TableRow cells={line.cells || []} header={isHeader} /></Box>;
          }
          case "hr":
            return <Text key={i} dimColor>{'─'.repeat(40)}</Text>;
          case "blank":
            return <Text key={i}> </Text>;
          case "text":
            return <Text key={i} wrap="wrap">{renderInline(line.content)}</Text>;
          default:
            return null;
        }
      })}
    </Box>
  );
}
