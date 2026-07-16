/**
 * Raw Multiline Input — textarea-style input for terminal.
 * Ctrl+J = newline, Enter = submit, Up/Down = line navigation or history.
 */
import React, { useState, useEffect, useRef } from "react";
import { Text, useInput } from "ink";

interface RawInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
  placeholder?: string;
  isActive?: boolean;
  onIntercept?: (ch: string, key: any) => boolean;
}

interface VisualLine {
  text: string;
  start: number;
  end: number;
}

export function RawInput({
  value,
  onChange,
  onSubmit,
  onHistoryUp,
  onHistoryDown,
  placeholder,
  isActive = true,
  onIntercept,
}: RawInputProps) {
  const [cursor, setCursor] = useState(value.length);
  const lastValueRef = useRef(value);

  // Sync cursor if value is updated from the outside (e.g. history, autocomplete)
  useEffect(() => {
    if (value !== lastValueRef.current) {
      setCursor(value.length);
      lastValueRef.current = value;
    }
  }, [value]);

  const W = process.stdout.columns || 80;

  useInput((ch, key) => {
    if (!isActive) return;
    if (onIntercept && onIntercept(ch, key)) return;

    const visualLines = allVisualLines(value, W);
    const visualCoord = getCursorCoords(visualLines, cursor);

    // 1. Intercept Ctrl+J / Line Feed (ch === "\n") before key.return checks
    if (ch === "\n") {
      const next = value.slice(0, cursor) + "\n" + value.slice(cursor);
      lastValueRef.current = next;
      onChange(next);
      setCursor(c => c + 1);
      return;
    }

    // 2. Submit on Enter / Return (ch === "\r" or key.return)
    if (key.return || ch === "\r") {
      onSubmit(value);
      return;
    }

    // 3. Backspace (delete character before cursor)
    if (key.backspace) {
      if (cursor > 0) {
        const next = value.slice(0, cursor - 1) + value.slice(cursor);
        lastValueRef.current = next;
        onChange(next);
        setCursor(c => c - 1);
      }
      return;
    }

    // 4. Delete (delete character under/after cursor)
    if (key.delete) {
      if (cursor < value.length) {
        const next = value.slice(0, cursor) + value.slice(cursor + 1);
        lastValueRef.current = next;
        onChange(next);
      }
      return;
    }

    // 5. Left/Right Navigation
    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1));
      return;
    }

    // 6. Up/Down Navigation with Single-Line History Fallback
    if (key.upArrow) {
      if (visualCoord.lineIdx > 0) {
        const targetLine = visualLines[visualCoord.lineIdx - 1];
        const targetCol = Math.min(visualCoord.colIdx, targetLine.text.length);
        setCursor(targetLine.start + targetCol);
      } else if (onHistoryUp && !value.includes("\n")) {
        onHistoryUp();
      }
      return;
    }
    if (key.downArrow) {
      if (visualCoord.lineIdx < visualLines.length - 1) {
        const targetLine = visualLines[visualCoord.lineIdx + 1];
        const targetCol = Math.min(visualCoord.colIdx, targetLine.text.length);
        setCursor(targetLine.start + targetCol);
      } else if (onHistoryDown && !value.includes("\n")) {
        onHistoryDown();
      }
      return;
    }

    // 7. Home/End Navigation (line level)
    if (key.home) {
      const targetLine = visualLines[visualCoord.lineIdx];
      setCursor(targetLine.start);
      return;
    }
    if (key.end) {
      const targetLine = visualLines[visualCoord.lineIdx];
      setCursor(targetLine.end);
      return;
    }

    if (key.ctrl || key.meta) return;

    // 8. Printable Character & Paste Verbatim Insertion (ch.length >= 1)
    if (ch && ch.length >= 1) {
      // Normalize CRLF to LF, strip control sequences but allow tabs and newlines
      const normalized = ch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const cleaned = normalized.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
      if (cleaned.length > 0) {
        const next = value.slice(0, cursor) + cleaned + value.slice(cursor);
        lastValueRef.current = next;
        onChange(next);
        setCursor(c => c + cleaned.length);
      }
    }
  });

  const clampedCursor = Math.min(cursor, value.length);
  if (clampedCursor !== cursor) setCursor(clampedCursor);

  if (!value && placeholder) {
    return <Text dimColor><Text inverse> </Text>{placeholder}</Text>;
  }

  const before = value.slice(0, clampedCursor);
  const cursorChar = value[clampedCursor] || " ";
  const after = value.slice(clampedCursor + 1);

  return (
    <Text wrap="wrap">
      {before}
      {cursorChar === "\n" ? (
        <>
          <Text inverse> </Text>
          {"\n"}
        </>
      ) : (
        <Text inverse>{cursorChar}</Text>
      )}
      {after}
    </Text>
  );
}

function wrapLogicalLine(
  lineText: string,
  startOffset: number,
  isFirstLogicalLine: boolean,
  W: number
): VisualLine[] {
  const lines: VisualLine[] = [];
  if (lineText.length === 0) {
    lines.push({ text: "", start: startOffset, end: startOffset });
    return lines;
  }

  let lineStart = 0;

  while (lineStart < lineText.length) {
    const isFirstVisualLine = isFirstLogicalLine && lines.length === 0;
    const limit = isFirstVisualLine ? Math.max(1, W - 2) : W;

    // If the remaining text fits in the limit, we are done
    if (lineText.length - lineStart <= limit) {
      lines.push({
        text: lineText.slice(lineStart),
        start: startOffset + lineStart,
        end: startOffset + lineText.length,
      });
      break;
    }

    // Otherwise, we need to find the best wrap point in lineText[lineStart ... lineStart + limit]
    let wrapPoint = lineStart + limit;

    // Search backwards for a space/separator
    let foundSpace = false;
    for (let i = wrapPoint; i > lineStart; i--) {
      if (lineText[i] === " " || lineText[i] === "\t") {
        wrapPoint = i;
        foundSpace = true;
        break;
      }
    }

    if (foundSpace) {
      // We wrap at the space.
      lines.push({
        text: lineText.slice(lineStart, wrapPoint),
        start: startOffset + lineStart,
        end: startOffset + wrapPoint,
      });
      // Skip the space itself for the next line start
      lineStart = wrapPoint + 1;
    } else {
      // If there is no space, we must force-break at the limit (character wrap)
      lines.push({
        text: lineText.slice(lineStart, wrapPoint),
        start: startOffset + lineStart,
        end: startOffset + wrapPoint,
      });
      lineStart = wrapPoint;
    }
  }

  return lines;
}

function allVisualLines(value: string, W: number): VisualLine[] {
  const result: VisualLine[] = [];
  let currentOffset = 0;

  const logicalLines = value.split("\n");
  for (let i = 0; i < logicalLines.length; i++) {
    const logicalLine = logicalLines[i];
    const isFirstLogicalLine = (i === 0);

    const wrapped = wrapLogicalLine(logicalLine, currentOffset, isFirstLogicalLine, W);
    result.push(...wrapped);

    // Add the length of the logical line plus 1 for the "\n" character
    currentOffset += logicalLine.length + 1;
  }

  return result;
}

function getCursorCoords(visualLines: VisualLine[], cursor: number): { lineIdx: number; colIdx: number } {
  // Search from last to first so we prefer the later line if cursor is at a boundary
  for (let i = visualLines.length - 1; i >= 0; i--) {
    const line = visualLines[i];
    if (cursor >= line.start && cursor <= line.end) {
      return {
        lineIdx: i,
        colIdx: cursor - line.start,
      };
    }
  }
  return { lineIdx: 0, colIdx: 0 };
}
