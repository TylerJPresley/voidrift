export type SafetyProfile = "auto-approved" | "gated";
export type ActionLayer = "file-ops" | "system-exec" | "web" | "lsp" | "orchestration" | "external";

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  actionLayer: ActionLayer;
  safetyProfile: SafetyProfile;
  parameters: ToolParameter[];
}
