/**
 * Structured Output Schemas.
 *
 * Uses LangChain's withStructuredOutput() to guarantee typed responses
 * from models when we need deterministic JSON (plan items, memory entries).
 */
import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export const PlanItemSchema = z.object({
  name: z.string().describe("Short slug identifier"),
  description: z.string().describe("1-2 sentence summary"),
  rationale: z.string().describe("Why this matters"),
  priority: z.enum(["now", "next", "later"]).describe("Priority level"),
});

export const MemoryEntrySchema = z.object({
  title: z.string().describe("Short title for the memory"),
  content: z.string().describe("The fact or preference to remember"),
  keywords: z.array(z.string()).describe("Keywords for retrieval"),
});

export const CompactionSummarySchema = z.object({
  activityLog: z.array(z.string()).describe("Chronological bullet points of progress"),
  filesTouched: z.array(z.string()).describe("Files and what changed"),
  unresolvedDiagnostics: z.array(z.string()).describe("Verbatim error snippets"),
  activeParameters: z.array(z.string()).describe("Key environment params or instructions"),
});

export type PlanItem = z.infer<typeof PlanItemSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type CompactionSummary = z.infer<typeof CompactionSummarySchema>;

/**
 * Binds a structured output schema to a model.
 * Returns a runnable that guarantees the response matches the schema.
 */
export function withStructured<T extends z.ZodType>(model: BaseChatModel, schema: T) {
  return model.withStructuredOutput(schema);
}
