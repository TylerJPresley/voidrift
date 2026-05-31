/**
 * Ink-native Markdown renderer.
 * Parses markdown line-by-line into React/Ink components with proper flexbox layout.
 * Handles streaming (incomplete) markdown gracefully.
 */
import React from "react";
import { Box, Text } from "ink";

interface MarkdownProps {
  text: string;
}

/** Render inline formatting: **bold**, *italic*, `code`, [links](url) */
function InlineText({ text }: { text: string }) {
  if (!/[*_`\[]/.test(text)) return <Text>{text}</Text>;

  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(<Text key={`t${last}`}>{text.slice(last, match.index)}</Text>);
    const key = `m${match.index}`;
    if (match[2]) nodes.push(<Text key={key} bold>{match[2]}</Text>);
    else if (match[3]) nodes.push(<Text key={key} bold>{match[3]}</Text>);
    else if (match[4]) nodes.push(<Text key={key} italic>{match[4]}</Text>);
    else if (match[5]) nodes.push(<Text key={key} italic>{match[5]}</Text>);
    else if (match[6]) nodes.push(<Text key={key} color="cyan">{match[6]}</Text>);
    else if (match[7]) nodes.push(<Text key={key} color="blue" underline>{match[7]}</Text>);
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(<Text key={`t${last}`}>{text.slice(last)}</Text>);
  return <>{nodes}</>;
}

export function Markdown({ text }: MarkdownProps) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = "";
  let lastEmpty = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `l${i}`;

    // Code fences
    if (line.match(/^```/)) {
      if (inCode) {
        blocks.push(<CodeBlock key={key} lines={codeBuf} lang={codeLang} />);
        inCode = false; codeBuf = []; codeLang = "";
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // Empty line
    if (!line.trim()) {
      if (!lastEmpty) blocks.push(<Box key={key} height={1} />);
      lastEmpty = true;
      continue;
    }
    lastEmpty = false;

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push(<Box key={key}><Text dimColor>{"─".repeat(40)}</Text></Box>);
      continue;
    }

    // Headers
    const hMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (hMatch) {
      blocks.push(<Box key={key}><Text bold color="green"><InlineText text={hMatch[2]} /></Text></Box>);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      blocks.push(
        <Box key={key} paddingLeft={indent}>
          <Box width={2}><Text>• </Text></Box>
          <Box flexGrow={1} flexShrink={1}><Text wrap="wrap"><InlineText text={ulMatch[3]} /></Text></Box>
        </Box>
      );
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      const indent = olMatch[1].length;
      const num = olMatch[2];
      const prefixW = num.length + 2;
      blocks.push(
        <Box key={key} paddingLeft={indent}>
          <Box width={prefixW}><Text>{num}. </Text></Box>
          <Box flexGrow={1} flexShrink={1}><Text wrap="wrap"><InlineText text={olMatch[3]} /></Text></Box>
        </Box>
      );
      continue;
    }

    // Table row detection
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      // Collect table
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].trim().endsWith("|")) {
        i++;
        tableLines.push(lines[i]);
      }
      blocks.push(<TableBlock key={key} lines={tableLines} />);
      continue;
    }

    // Paragraph
    blocks.push(<Box key={key}><Text wrap="wrap"><InlineText text={line} /></Text></Box>);
  }

  // Unclosed code block (streaming)
  if (inCode && codeBuf.length) {
    blocks.push(<CodeBlock key="code-eof" lines={codeBuf} lang={codeLang} />);
  }

  return <>{blocks}</>;
}

function CodeBlock({ lines, lang }: { lines: string[]; lang: string }) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {lang && <Text dimColor>{`── ${lang} ──`}</Text>}
      {lines.map((l, i) => <Text key={i} color="gray">{l}</Text>)}
    </Box>
  );
}

function TableBlock({ lines }: { lines: string[] }) {
  // Parse cells
  const parseRow = (line: string) => line.split("|").slice(1, -1).map(c => c.trim());
  const rows = lines.filter(l => !/^[\s|:-]+$/.test(l)).map(parseRow);
  if (rows.length === 0) return null;

  // Calculate column widths, constrained to terminal
  const termWidth = (process.stdout.columns || 80) - 4; // padding
  const colCount = rows[0].length;
  const widths = Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(widths[c], (row[c] || "").length);
    }
  }

  // Shrink columns proportionally if total exceeds terminal width
  const separatorCost = colCount * 3 + 2; // "│ " per col + outer
  const totalContent = widths.reduce((a, b) => a + b, 0);
  const available = termWidth - separatorCost;
  if (totalContent > available && available > colCount) {
    const ratio = available / totalContent;
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(4, Math.floor(widths[c] * ratio));
    }
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {rows.map((row, ri) => (
        <Box key={ri}>
          <Text>│ </Text>
          {row.map((cell, ci) => {
            const w = widths[ci] || 10;
            const display = cell.length > w ? cell.slice(0, w - 1) + "…" : cell.padEnd(w);
            return (
              <React.Fragment key={ci}>
                <Text bold={ri === 0}>{ri === 0 ? display : ""}</Text>
                {ri !== 0 && <InlineText text={display} />}
                <Text> │ </Text>
              </React.Fragment>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
