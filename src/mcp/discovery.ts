/**
 * MCP Server Auto-Discovery.
 *
 * Given a URL, discovers:
 * - Transport type (HTTP+SSE)
 * - Auth requirements (OAuth2 via RFC 9728 protected resource metadata)
 * - Authorization server metadata (endpoints, scopes, PKCE)
 * - Dynamic client registration if supported
 */

import { VERSION } from "../version.js";

export interface MCPDiscoveryResult {
  url: string;
  transport: "http-sse";
  requiresAuth: boolean;
  authConfig?: {
    authorizeUrl: string;
    tokenUrl: string;
    registrationUrl?: string;
    scopes: string[];
    codeChallengeMethod?: string;
    tokenAuthMethod?: string;
  };
  clientId?: string;
  clientSecret?: string;
  error?: string;
}

/**
 * Discover MCP server capabilities from a URL.
 * Follows the MCP OAuth discovery chain:
 *   initialize → www_authenticate → .well-known/oauth-protected-resource → .well-known/oauth-authorization-server
 */
export async function discoverMCPServer(url: string, onStatus?: (msg: string) => void): Promise<MCPDiscoveryResult> {
  const result: MCPDiscoveryResult = { url, transport: "http-sse", requiresAuth: false };

  try {
    // 1. Try initialize to see if auth is needed
    onStatus?.("Probing server...");
    const initRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "initialize", id: 1,
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "voidrift", version: VERSION } },
      }),
    });

    const initBody = await initRes.json() as any;

    // If no error, server doesn't require auth
    if (!initBody.error) {
      onStatus?.("Server accessible without auth.");
      return result;
    }

    // Check for auth requirement
    const wwwAuth = initBody.error?.data?._meta?.["mcp/www_authenticate"];
    if (!wwwAuth) {
      result.error = `Server returned error: ${initBody.error?.message ?? "unknown"}`;
      return result;
    }

    result.requiresAuth = true;

    // 2. Extract resource metadata URL from www_authenticate
    const resourceMetaUrl = extractResourceMetadataUrl(wwwAuth);
    if (!resourceMetaUrl) {
      result.error = "Could not parse resource metadata URL from auth challenge.";
      return result;
    }

    onStatus?.("Fetching resource metadata...");
    const resourceRes = await fetch(resourceMetaUrl);
    if (!resourceRes.ok) { result.error = `Resource metadata fetch failed: ${resourceRes.status}`; return result; }
    const resourceMeta = await resourceRes.json() as any;

    const authServer = resourceMeta.authorization_servers?.[0];
    if (!authServer) { result.error = "No authorization server found."; return result; }
    const scopes = resourceMeta.scopes_supported ?? [];

    // 3. Fetch authorization server metadata
    onStatus?.("Fetching auth server metadata...");
    const authMetaUrl = `${authServer}/.well-known/oauth-authorization-server`;
    const authRes = await fetch(authMetaUrl);
    if (!authRes.ok) { result.error = `Auth server metadata fetch failed: ${authRes.status}`; return result; }
    const authMeta = await authRes.json() as any;

    result.authConfig = {
      authorizeUrl: authMeta.authorization_endpoint,
      tokenUrl: authMeta.token_endpoint,
      registrationUrl: authMeta.registration_endpoint,
      scopes,
      codeChallengeMethod: authMeta.code_challenge_methods_supported?.[0],
      tokenAuthMethod: authMeta.token_endpoint_auth_methods_supported?.[0],
    };

    // 4. Dynamic client registration if supported
    if (authMeta.registration_endpoint) {
      onStatus?.("Registering client...");
      const regRes = await fetch(authMeta.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "VoidRift",
          redirect_uris: ["http://localhost:9876/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (regRes.ok) {
        const regData = await regRes.json() as any;
        result.clientId = regData.client_id;
        result.clientSecret = regData.client_secret;
        onStatus?.(`Client registered: ${regData.client_id}`);
      }
    }

    onStatus?.("Discovery complete.");
    return result;
  } catch (err) {
    result.error = `Discovery failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

function extractResourceMetadataUrl(wwwAuth: string): string | null {
  // Format: Bearer resource_metadata="https://..."
  const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
  return match?.[1] ?? null;
}

/** Generate an MCPServerConfig from discovery results */
export function buildConfigFromDiscovery(name: string, discovery: MCPDiscoveryResult): Record<string, unknown> {
  const config: Record<string, unknown> = {
    transport: "http-sse",
    url: discovery.url,
  };

  if (discovery.requiresAuth && discovery.authConfig) {
    config.auth = {
      type: "oauth2",
      authorizeUrl: discovery.authConfig.authorizeUrl,
      tokenUrl: discovery.authConfig.tokenUrl,
      scopes: discovery.authConfig.scopes,
      clientId: discovery.clientId ?? "",
      codeChallengeMethod: discovery.authConfig.codeChallengeMethod,
      tokenEnvVar: `${name.toUpperCase().replace(/-/g, "_")}_TOKEN`,
    };
  }

  return config;
}
