/**
 * Tool registry: OpenAI-format tool definitions (10 domain tools).
 * tool builder imports schemas from here — zero inline schemas elsewhere.
 */

export interface ToolDef {
  type: "function";
  concurrent_safe?: boolean;
  _guidelines?: string[];
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const DOMAIN_FILE: ToolDef = {
  type: "function",
  function: {
    name: "file",
    description: "Read, write, edit, delete, or list files in the project.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "edit", "delete", "list"], description: "Operation to perform" },
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "File content (write action)" },
        old_str: { type: "string", description: "Text to find (edit action)" },
        new_str: { type: "string", description: "Replacement text (edit action)" },
        offset: { type: "integer", description: "Line offset for reading (read action)" },
        limit: { type: "integer", description: "Max lines to read (read action)" },
        force_write: { type: "boolean", description: "Overwrite externally modified file (write action)" },
      },
      required: ["action"],
    },
  },
  _guidelines: [
    "Read files before writing to understand current state.",
    "Use edit for surgical changes, write for new files or full rewrites.",
  ],
};

export const DOMAIN_HTTP: ToolDef = {
  type: "function",
  function: {
    name: "http",
    description: "Make HTTP requests. GET without a session summarizes the response.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "post", "put", "delete"], description: "HTTP method" },
        url: { type: "string", description: "Request URL" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
        session_id: { type: "string", description: "Session ID for cookie/auth persistence" },
      },
      required: ["action", "url"],
    },
  },
};

export const DOMAIN_SHELL: ToolDef = {
  type: "function",
  function: {
    name: "shell",
    description: "Run a shell command.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Shell command to run" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["cmd"],
    },
  },
};

export const DOMAIN_BROWSER: ToolDef = {
  type: "function",
  function: {
    name: "browser",
    description: "Control a browser for testing.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "screenshot", "click", "get_text"], description: "Browser action" },
        url: { type: "string", description: "URL to navigate to" },
        selector: { type: "string", description: "CSS selector" },
        session_id: { type: "string", description: "Browser session ID" },
      },
      required: ["action"],
    },
  },
};

export const DOMAIN_PROCESS: ToolDef = {
  type: "function",
  function: {
    name: "process",
    description: "Read output from a running process.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read_output"], description: "Process action" },
        handle_id: { type: "string", description: "Process handle ID" },
      },
      required: ["action", "handle_id"],
    },
  },
};

export const DOMAIN_SKILL: ToolDef = {
  type: "function",
  concurrent_safe: true,
  function: {
    name: "skill",
    description: "Load or list available skills.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "list"], description: "Skill action" },
        name: { type: "string", description: "Skill name (get action)" },
        topic: { type: "string", description: "Section within the skill (get action)" },
      },
      required: ["action"],
    },
  },
};

export const DOMAIN_MEMORY: ToolDef = {
  type: "function",
  concurrent_safe: true,
  function: {
    name: "memory",
    description: "Persist knowledge across sessions.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "list", "delete"], description: "Memory action" },
        name: { type: "string", description: "Entry name" },
        content: { type: "string", description: "Entry content (write action)" },
        scope: { type: "string", enum: ["project", "global"], description: "Storage scope (default: project)" },
        description: { type: "string", description: "Entry description (write action)" },
      },
      required: ["action"],
    },
  },
};

export const DOMAIN_SESSION: ToolDef = {
  type: "function",
  concurrent_safe: true,
  function: {
    name: "session",
    description: "Search conversation history.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search"], description: "Session action" },
        query: { type: "string", description: "Search query" },
        limit: { type: "integer", description: "Max results (default 5, max 10)" },
      },
      required: ["action", "query"],
    },
  },
};

export const DOMAIN_ANALYZE: ToolDef = {
  type: "function",
  concurrent_safe: true,
  function: {
    name: "analyze",
    description: "Analyze source files or extract text from documents.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["code", "document"], description: "Analysis type" },
        path: { type: "string", description: "File path relative to project root" },
      },
      required: ["action", "path"],
    },
  },
};

export const DOMAIN_ASK: ToolDef = {
  type: "function",
  function: {
    name: "ask",
    description: "Ask the operator a question.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question to ask" },
        options: { type: "array", items: { type: "string" }, description: "Optional numbered choices" },
      },
      required: ["question"],
    },
  },
};

export const DOMAIN_TOOLS: ToolDef[] = [
  DOMAIN_FILE, DOMAIN_HTTP, DOMAIN_SHELL, DOMAIN_BROWSER, DOMAIN_PROCESS,
  DOMAIN_SKILL, DOMAIN_MEMORY, DOMAIN_SESSION, DOMAIN_ANALYZE, DOMAIN_ASK,
];
