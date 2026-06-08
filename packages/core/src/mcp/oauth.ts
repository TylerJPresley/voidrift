import { createServer, type Server } from "http";
import { URL } from "url";
import { saveCredential, type StoredCredential } from "./credentials.js";
import type { MCPAuthConfig } from "./engine.js";

const CALLBACK_PORT = 9876;
const CALLBACK_PATH = "/callback";

/**
 * Run the OAuth2 authorization code flow.
 * 1. Opens browser to authorize URL
 * 2. Listens on localhost for callback with code
 * 3. Exchanges code for tokens
 * 4. Saves credential to encrypted store
 */
export async function runOAuthFlow(
  serverName: string,
  auth: MCPAuthConfig,
  openBrowser: (url: string) => void,
  onStatus?: (msg: string) => void
): Promise<StoredCredential | null> {
  const clientId = auth.clientIdEnv ? (process.env[auth.clientIdEnv] ?? auth.clientId ?? "") : (auth.clientId ?? "");
  const clientSecret = auth.clientSecretEnv ? (process.env[auth.clientSecretEnv] ?? auth.clientSecret ?? "") : (auth.clientSecret ?? "");
  const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
  const scopes = auth.scopes?.join(" ") ?? "";

  // Build authorize URL
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    ...(scopes ? { scope: scopes } : {}),
  });
  const authorizeUrl = `${auth.authorizeUrl}?${params.toString()}`;

  onStatus?.("Opening browser for authorization...");
  openBrowser(authorizeUrl);

  // Wait for callback
  const code = await waitForCallback(onStatus);
  if (!code) return null;

  onStatus?.("Exchanging code for token...");

  // Exchange code for token
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  try {
    const res = await fetch(auth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    if (!res.ok) {
      onStatus?.(`Token exchange failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json() as any;
    const credential: StoredCredential = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };

    saveCredential(serverName, credential);
    onStatus?.("Authentication successful. Credentials saved.");
    return credential;
  } catch (err) {
    onStatus?.(`Token exchange error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function waitForCallback(onStatus?: (msg: string) => void): Promise<string | null> {
  return new Promise((resolve) => {
    let server: Server;
    const timeout = setTimeout(() => {
      server?.close();
      onStatus?.("OAuth callback timed out (60s).");
      resolve(null);
    }, 60_000);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404); res.end(); return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>");
        clearTimeout(timeout);
        server.close();
        resolve(null);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to VoidRift.</p></body></html>");
      clearTimeout(timeout);
      server.close();
      resolve(code);
    });

    server.listen(CALLBACK_PORT, () => {
      onStatus?.(`Listening on http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}...`);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      onStatus?.(`Failed to start callback server: ${err.message}`);
      resolve(null);
    });
  });
}
