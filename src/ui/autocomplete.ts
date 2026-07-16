/**
 * Tab Autocompletion Engine.
 *
 * Resolves completions for:
 * - Slash commands (when input starts with /)
 * - File paths (for arguments to commands like /import, /diff)
 *
 * File indexing is done externally (via CoreAPI) — this module only
 * operates on pre-built string arrays. Zero filesystem access.
 */

export class AutocompleteEngine {
  private commands: string[] = [];
  private fileIndex: string[] = [];
  private _listFiles?: () => string[];

  /**
   * Registers available slash commands for completion.
   */
  setCommands(commands: string[]): void {
    this.commands = commands;
  }

  /**
   * Updates the file index. Called with results from CoreAPI.
   */
  setFileIndex(files: string[]): void {
    this.fileIndex = files;
  }

  /**
   * Build a file index from a workspace root via CoreAPI.
   * Accepts a listFiles callback (from core.workspace.listFiles).
   */
  indexWorkspace(_workspaceRoot: string, listFiles?: () => string[]): void {
    if (listFiles) {
      this._listFiles = listFiles;
      this.fileIndex = listFiles();
    } else if (this._listFiles) {
      this.fileIndex = this._listFiles();
    }
  }

  /**
   * Resolves completions for the current input text and cursor position.
   * Returns matching candidates.
   */
  complete(input: string): string[] {
    const trimmed = input.trimStart();

    // Command autocompletion: input starts with /
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const partial = trimmed.slice(1).toLowerCase();
      return this.commands
        .filter((cmd) => cmd.toLowerCase().startsWith(partial))
        .map((cmd) => `/${cmd}`);
    }

    // Path autocompletion: last word in input
    const words = trimmed.split(/\s+/);
    const lastWord = words[words.length - 1] || "";
    if (!lastWord) return [];

    return this.fileIndex
      .filter((f) => f.startsWith(lastWord) || f.includes(lastWord))
      .slice(0, 10);
  }

  /**
   * Cycles through candidates on repeated TAB presses.
   */
  cycle(candidates: string[], currentIndex: number): { value: string; nextIndex: number } {
    if (candidates.length === 0) return { value: "", nextIndex: 0 };
    const idx = currentIndex % candidates.length;
    return { value: candidates[idx], nextIndex: idx + 1 };
  }
}
