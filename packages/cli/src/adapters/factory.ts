import type { ModelConfig } from "../config/loader.js";
import { OpenAIAdapter } from "./openai.js";

export type { ChatMessage, StreamChunk, ToolCallMessage, OpenAITool } from "./openai.js";

export function createAdapter(config: ModelConfig) {
  switch (config.protocol) {
    case "openai":
      return new OpenAIAdapter(config);
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }
}
