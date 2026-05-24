import type { ChatMessage, StreamChunk } from "../adapters/openai.js";
import type { OpenAIAdapter } from "../adapters/openai.js";

export class SessionManager {
  private history: ChatMessage[] = [];
  private adapter: OpenAIAdapter;

  constructor(adapter: OpenAIAdapter) {
    this.adapter = adapter;
  }

  async *send(text: string): AsyncGenerator<StreamChunk> {
    this.history.push({ role: "user", content: text });

    let full = "";
    for await (const chunk of this.adapter.stream(this.history)) {
      if (chunk.content) full += chunk.content;
      yield chunk;
    }

    this.history.push({ role: "assistant", content: full });
  }

  getHistory(): ChatMessage[] {
    return this.history;
  }
}
