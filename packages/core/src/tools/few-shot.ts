/**
 * Few-Shot Tool Examples.
 *
 * Provides example interactions showing correct tool usage,
 * injected via FewShotChatMessagePromptTemplate when relevant tools are bound.
 * Focus: edit_file accuracy (models frequently get search blocks wrong).
 */
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export interface ToolExample {
  /** Which tool this example demonstrates */
  toolName: string;
  /** The example messages (human → AI with tool call → tool result) */
  messages: BaseMessage[];
}

export const EDIT_FILE_EXAMPLES: ToolExample[] = [
  {
    toolName: "edit_file",
    messages: [
      new HumanMessage("Add error handling to the save function"),
      new AIMessage({
        content: "I'll add a try-catch around the file write operation.",
        tool_calls: [{
          id: "ex1",
          name: "edit_file",
          args: {
            path: "src/storage.ts",
            search: `function save(data: string) {\n  writeFileSync(OUTPUT_PATH, data);\n}`,
            replace: `function save(data: string) {\n  try {\n    writeFileSync(OUTPUT_PATH, data);\n  } catch (err) {\n    throw new Error(\`Failed to save: \${err instanceof Error ? err.message : err}\`);\n  }\n}`,
          },
        }],
      }),
      new ToolMessage({ content: "Edit applied successfully.", tool_call_id: "ex1" }),
    ],
  },
];

/**
 * Returns few-shot messages for the given tool names.
 * Intended to be prepended to conversation history for tool-use accuracy.
 */
export function getFewShotExamples(toolNames: string[]): BaseMessage[] {
  const examples: BaseMessage[] = [];
  if (toolNames.includes("edit_file")) {
    for (const ex of EDIT_FILE_EXAMPLES) {
      examples.push(...ex.messages);
    }
  }
  return examples;
}
