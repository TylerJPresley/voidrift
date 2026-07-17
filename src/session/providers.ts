/**
 * Context Layer Providers — extension points for plugins to inject content
 * into the prompt assembly layers.
 *
 * Plugins register providers per layer. The compiler calls them during assembly.
 * This is how planning, memory, workspace map, and any plugin contribute
 * to the model's context without hardcoding in the compiler.
 */

export type ContextLayer = "agent" | "orbit" | "drift";

export interface ContextProvider {
  key: string;
  layer: ContextLayer;
  provider: () => string | null;
}

const providers: ContextProvider[] = [];

/**
 * Register a context provider for a specific layer.
 * The compiler will call provider() during prompt assembly and include
 * non-null results in the appropriate layer.
 */
export function registerContextProvider(layer: ContextLayer, key: string, provider: () => string | null): void {
  // Replace if same key exists (allows override)
  const idx = providers.findIndex(p => p.key === key && p.layer === layer);
  if (idx >= 0) {
    providers[idx] = { key, layer, provider };
  } else {
    providers.push({ key, layer, provider });
  }
}

/**
 * Get all registered providers for a specific layer.
 * Called by the compiler during prompt assembly.
 */
export function getProviders(layer: ContextLayer): ContextProvider[] {
  return providers.filter(p => p.layer === layer);
}

/**
 * Clear all providers (for testing).
 */
export function clearProviders(): void {
  providers.length = 0;
}
