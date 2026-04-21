/**
 * StatusLine: a single updatable line in the gather/command output.
 *
 * TUI mode: backed by a ContentRegion message updated by reference.
 * CLI mode: overwrites the current terminal line via \r.
 */

export interface StatusLine {
  update(text: string): void;
}

export interface StatusOutput {
  /** Create a new line with initial text. */
  addLine(text: string): StatusLine;
  /** Append text to the last line (no new line created). */
  append(text: string): void;
  /** Create a block of updatable lines rendered as one message. */
  addBlock(): StatusBlock;
}

export interface StatusBlock {
  /** Add a static line (not updatable). */
  addStatic(text: string): void;
  /** Add an updatable line, returns a StatusLine to update it. */
  addLine(text: string): StatusLine;
}

// ---------------------------------------------------------------------------
// TUI implementation — backed by ContentRegion
// ---------------------------------------------------------------------------

import type { ContentRegion, TUIMessage } from "../tui/regions/ContentRegion.js";

class TUIBlock implements StatusBlock {
  private lines: string[] = [];
  private msg: TUIMessage;
  private content: ContentRegion;

  constructor(content: ContentRegion) {
    this.content = content;
    this.msg = content.addSystem("");
  }

  private render(): void {
    this.content.updateMessage(this.msg, this.lines.join("\n"));
  }

  addStatic(text: string): void {
    this.lines.push(text);
    this.render();
  }

  addLine(text: string): StatusLine {
    const idx = this.lines.length;
    this.lines.push(text);
    this.render();
    return {
      update: (t: string) => { this.lines[idx] = t; this.render(); },
    };
  }
}

export function createTUIStatus(content: ContentRegion): StatusOutput {
  return {
    addLine(text: string): StatusLine {
      const msg = content.addSystem(text);
      return { update: (t: string) => content.updateMessage(msg, t) };
    },
    append(text: string): void {
      content.appendSystem(text);
    },
    addBlock(): StatusBlock {
      return new TUIBlock(content);
    },
  };
}

// ---------------------------------------------------------------------------
// CLI implementation — writes to stderr
// ---------------------------------------------------------------------------

class CLIBlock implements StatusBlock {
  private lines: string[] = [];
  private lineCount = 0;

  private render(): void {
    // Move up to overwrite all lines, then rewrite
    if (this.lineCount > 0) {
      process.stderr.write(`\x1b[${this.lineCount}A\r`);
    }
    const output = this.lines.join("\n");
    process.stderr.write(`\x1b[0J${output}\n`);
    this.lineCount = this.lines.length;
  }

  addStatic(text: string): void {
    this.lines.push(text);
    this.render();
  }

  addLine(text: string): StatusLine {
    const idx = this.lines.length;
    this.lines.push(text);
    this.render();
    return {
      update: (t: string) => { this.lines[idx] = t; this.render(); },
    };
  }
}

export function createCLIStatus(): StatusOutput {
  let lastIsLive = false;
  return {
    addLine(text: string): StatusLine {
      if (lastIsLive) process.stderr.write("\n");
      process.stderr.write(text);
      lastIsLive = true;
      return {
        update(t: string): void {
          process.stderr.write(`\r\x1b[2K${t}`);
          lastIsLive = true;
        },
      };
    },
    append(text: string): void {
      if (lastIsLive) { process.stderr.write("\n"); lastIsLive = false; }
      process.stderr.write(text + "\n");
    },
    addBlock(): StatusBlock {
      if (lastIsLive) { process.stderr.write("\n"); lastIsLive = false; }
      return new CLIBlock();
    },
  };
}
