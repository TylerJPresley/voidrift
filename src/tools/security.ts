/**
 * Command security classification (REQ-SEC-2).
 */

export interface CommandClassification {
  level: "safe" | "warn" | "block";
  reasons: string[];
}

const BLOCK_PATTERNS: Array<[RegExp, string]> = [
  [/rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/\s*$|rm\s+-[^\s]*f[^\s]*r[^\s]*\s+\/\s*$/, "destructive recursive delete of /"],
  [/rm\s+-[^\s]*r[^\s]*f[^\s]*\s+~\/?\s*$|rm\s+-[^\s]*f[^\s]*r[^\s]*\s+~\/?\s*$/, "destructive recursive delete of home"],
  [/:\(\)\s*\{.*\|.*&\s*\}\s*;/, "fork bomb"],
  [/dd\s+if=\/dev\/zero/, "disk overwrite"],
  [/mkfs\b/, "filesystem format"],
  [/(curl|wget)\s+[^|]+\|\s*(bash|sh|zsh)\b/, "remote code execution via pipe"],
  [/chmod\s+777\s+\//, "world-writable root"],
];

const BLOCK_WRITE_PATHS = /(?:>|>>)\s*(?:\/etc\/|\/boot\/|\/sys\/|\/proc\/)/;

const WARN_PATTERNS: Array<[RegExp, string]> = [
  [/rm\s+-[^\s]*r[^\s]*f/, "recursive force delete"],
  [/git\s+push\s+--force/, "force push"],
  [/git\s+reset\s+--hard/, "hard reset"],
  [/\bsudo\b/, "elevated privileges"],
  [/chmod\s+-R/, "recursive permission change"],
  [/pip\s+install.*--break-system-packages/, "system package modification"],
];

function matchesGlob(cmd: string, pattern: string): boolean {
  const prefix = pattern.replace(/\*+$/, "").trimEnd();
  if (pattern.includes("*")) {
    const re = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return re.test(cmd) || cmd.startsWith(prefix);
  }
  return cmd === pattern;
}

export function classifyCommand(command: string, allowedCommands?: string[]): CommandClassification {
  const cmd = command.trim();

  if (allowedCommands) {
    for (const pattern of allowedCommands) {
      if (matchesGlob(cmd, pattern)) return { level: "safe", reasons: [] };
    }
  }

  const blockReasons: string[] = [];
  for (const [pat, reason] of BLOCK_PATTERNS) {
    if (pat.test(cmd)) blockReasons.push(reason);
  }
  if (BLOCK_WRITE_PATHS.test(cmd)) blockReasons.push("write to protected system path");
  if (blockReasons.length) return { level: "block", reasons: blockReasons };

  const warnReasons: string[] = [];
  for (const [pat, reason] of WARN_PATTERNS) {
    if (pat.test(cmd)) warnReasons.push(reason);
  }
  if (warnReasons.length) return { level: "warn", reasons: warnReasons };

  return { level: "safe", reasons: [] };
}
