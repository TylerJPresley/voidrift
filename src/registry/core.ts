export interface CapabilityHook {
  name: string;
  trigger: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SlashCommandHook {
  name: string;
  description: string;
  source?: string;
  execute: (args: string[]) => Promise<void>;
}

export class CoreRegistry {
  private capabilities = new Map<string, CapabilityHook>();
  private slashCommands = new Map<string, SlashCommandHook>();

  registerCapability(hook: CapabilityHook): void {
    if (this.capabilities.has(hook.name)) {
      throw new Error(`Capability "${hook.name}" already registered`);
    }
    this.capabilities.set(hook.name, hook);
  }

  registerSlashCommand(hook: SlashCommandHook): void {
    this.slashCommands.set(hook.name, hook);
  }

  async invokeCapability(name: string, args: Record<string, unknown>): Promise<unknown> {
    const cap = this.capabilities.get(name);
    if (!cap) throw new Error(`Capability "${name}" not registered`);
    return cap.execute(args);
  }

  getSlashCommand(name: string): SlashCommandHook | undefined {
    return this.slashCommands.get(name);
  }

  listCapabilities(): string[] {
    return [...this.capabilities.keys()];
  }

  listSlashCommands(): string[] {
    return [...this.slashCommands.keys()].sort();
  }

  listSlashCommandHooks(): SlashCommandHook[] {
    return [...this.slashCommands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
