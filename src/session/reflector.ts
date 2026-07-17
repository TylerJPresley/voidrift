/**
 * Reflection Engine — analyzes past sessions and extracts persistent lessons.
 *
 * Reads session histories, batches them for model analysis, and saves
 * extracted lessons as structured memories for future sessions.
 *
 * Non-blocking: runs in background with progress reporting via event bus.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { EventBus } from "../events/bus.js";
import type { SessionBrain } from "./brain.js";
import type { MemoryRepository } from "./memory-repository.js";
import type { MemoryMeta } from "./memory.js";
import { join } from "path";

const REFLECTION_PROMPT = `You analyze past AI assistant sessions and extract actionable lessons that should persist across sessions.

For each lesson you identify, output a JSON object with these fields:
- title: Short descriptive title (under 10 words)
- summary: One sentence explaining the lesson
- keywords: Comma-separated retrieval keywords (2-4 words the user would say when this lesson is relevant)
- type: "directive" (always load) or "reference" (load on keyword match)
- body: The full lesson content (2-3 sentences max)

Output a JSON array of lessons. Only extract lessons that are:
- Reusable across sessions (not one-time facts)
- About the project, conventions, or user preferences
- Not already obvious from the codebase itself

If no lessons are worth saving, output [].`;

const BATCH_SIZE = 3;

export interface ReflectionResult {
  totalSessions: number;
  lessonsExtracted: number;
  summary: string;
}

export class ReflectionEngine {
  constructor(
    private brain: SessionBrain,
    private memoryDir: string,
    private memoryRepo: MemoryRepository,
    private bus: EventBus,
    private batchSize = BATCH_SIZE,
  ) {}

  async run(client: BaseChatModel): Promise<ReflectionResult> {
    const sessions = this.brain.listSessions();
    if (sessions.length === 0) {
      return { totalSessions: 0, lessonsExtracted: 0, summary: "No past sessions found." };
    }

    this.bus.publish("WARNING_EMITTED", {
      message: `Reflecting on ${sessions.length} past sessions...`,
      source: "reflection",
      category: "info",
    });

    const batches: typeof sessions[] = [];
    for (let i = 0; i < sessions.length; i += this.batchSize) {
      batches.push(sessions.slice(i, i + this.batchSize));
    }

    const allLessons: Array<{ title: string; summary: string; keywords: string; type: string; body: string }> = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchText = await this.loadBatchText(batch);
      if (!batchText.trim()) continue;

      try {
        const response = await client.invoke([
          new SystemMessage(REFLECTION_PROMPT),
          new HumanMessage(`Sessions to analyze:\n\n${batchText}`),
        ], { max_tokens: 1000, temperature: 0.2 } as any);

        const text = typeof response.content === "string" ? response.content : "";
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            const valid = parsed.filter(l => l.title && l.body);
            for (const lesson of valid) {
              this.bus.publish("WARNING_EMITTED", {
                message: `  📝 ${lesson.title}`,
                source: "reflection",
                category: "info",
              });
            }
            allLessons.push(...valid);
          }
        }
      } catch {}

      this.bus.publish("WARNING_EMITTED", {
        message: `Reflection progress: batch ${i + 1}/${batches.length}, ${allLessons.length} lessons found`,
        source: "reflection",
        category: "info",
      });
    }

    // Save lessons as memories (update existing if context overlaps)
    const existing = this.memoryRepo.scan([this.memoryDir]);

    for (const lesson of allLessons) {
      const keywords = lesson.keywords.split(",").map(k => k.trim()).filter(Boolean);
      // Find existing memory with overlapping keywords
      const match = existing.find(e => {
        const existingKw = e.meta.context.keywords || [];
        return existingKw.some(kw => keywords.some(nk => nk.toLowerCase() === kw.toLowerCase()));
      });
      const id = match ? match.meta.id : `reflect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const meta: MemoryMeta = {
        id,
        title: lesson.title,
        summary: lesson.summary,
        type: (lesson.type === "directive" ? "directive" : "reference"),
        context: { keywords },
        filePath: join(this.memoryDir, `${id}.md`),
      };
      this.memoryRepo.save(this.memoryDir, meta, lesson.body);
    }

    const summary = allLessons.length > 0
      ? `Reflected on ${sessions.length} sessions. Extracted ${allLessons.length} lessons: ${allLessons.map(l => l.title).join(", ")}`
      : `Reflected on ${sessions.length} sessions. No new lessons found.`;

    return { totalSessions: sessions.length, lessonsExtracted: allLessons.length, summary };
  }

  private async loadBatchText(sessions: Array<{ id: string; turnCount: number }>): Promise<string> {
    const parts: string[] = [];
    for (const session of sessions) {
      const loaded = this.brain.loadSession(session.id, { setMessages: () => {}, setPlan: () => {}, setDiagnostics: () => {} } as any);
      if (!loaded) continue;
      // Read messages directly from the session file
      const { existsSync, readFileSync } = await import("fs");
      const sessionsDir = join(this.memoryDir, "..", "sessions");
      const msgsPath = join(sessionsDir, session.id, "work.messages.json");
      if (!existsSync(msgsPath)) continue;
      try {
        const msgs = JSON.parse(readFileSync(msgsPath, "utf-8"));
        const userMsgs = msgs.filter((m: any) => m.role === "user").map((m: any) => m.content.slice(0, 200));
        const assistantMsgs = msgs.filter((m: any) => m.role === "assistant").map((m: any) => m.content.slice(0, 200));
        parts.push(`Session ${session.id} (${session.turnCount} turns):\nUser: ${userMsgs.join(" | ")}\nAssistant: ${assistantMsgs.join(" | ")}`);
      } catch {}
    }
    return parts.join("\n\n---\n\n");
  }
}
