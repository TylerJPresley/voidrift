/**
 * LangChain InMemoryCache for repeated model calls.
 *
 * Caches identical prompt → response pairs so that repeated
 * summarization calls (same file content) hit cache instead of the model.
 */
import { InMemoryCache } from "@langchain/core/caches";

// Singleton cache instance shared across all model calls
const _cache = new InMemoryCache();

/**
 * Returns the shared InMemoryCache.
 * Pass to model constructor: `new ChatOpenAI({ cache: getModelCache() })`
 */
export function getModelCache(): InMemoryCache {
  return _cache;
}
