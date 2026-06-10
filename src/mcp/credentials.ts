import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import type { MCPAuthConfig } from "./engine.js";

const CRED_DIR = join(homedir(), ".config", "voidrift", "credentials");
const ENCRYPTION_KEY_SOURCE = `voidrift-${homedir()}`; // Deterministic per-user key

export interface StoredCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // unix ms
  tokenType?: string;
  scope?: string;
}

interface EncryptedFile {
  iv: string;
  data: string;
}

function getKey(): Buffer {
  return scryptSync(ENCRYPTION_KEY_SOURCE, "voidrift-salt", 32);
}

function encrypt(data: string): EncryptedFile {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf-8"), cipher.final()]);
  return { iv: iv.toString("hex"), data: encrypted.toString("hex") };
}

function decrypt(file: EncryptedFile): string {
  const key = getKey();
  const iv = Buffer.from(file.iv, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(file.data, "hex")), decipher.final()]);
  return decrypted.toString("utf-8");
}

export function saveCredential(serverName: string, credential: StoredCredential): void {
  mkdirSync(CRED_DIR, { recursive: true });
  const encrypted = encrypt(JSON.stringify(credential));
  writeFileSync(join(CRED_DIR, `${serverName}.json`), JSON.stringify(encrypted, null, 2), "utf-8");
}

export function loadCredential(serverName: string): StoredCredential | null {
  const path = join(CRED_DIR, `${serverName}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted);
  } catch { return null; }
}

export function deleteCredential(serverName: string): void {
  const path = join(CRED_DIR, `${serverName}.json`);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function hasCredential(serverName: string): boolean {
  return existsSync(join(CRED_DIR, `${serverName}.json`));
}

/** Refresh token if expired. Returns updated credential (saved to disk). */
export async function refreshIfNeeded(cred: StoredCredential, auth: MCPAuthConfig): Promise<StoredCredential | null> {
  if (!cred.expiresAt || Date.now() < cred.expiresAt - 60_000) {
    return cred; // Not expired (with 60s buffer)
  }
  if (!cred.refreshToken) return null; // Can't refresh

  const clientId = auth.clientIdEnv ? (process.env[auth.clientIdEnv] ?? auth.clientId ?? "") : (auth.clientId ?? "");
  const clientSecret = auth.clientSecretEnv ? (process.env[auth.clientSecretEnv] ?? auth.clientSecret ?? "") : (auth.clientSecret ?? "");

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cred.refreshToken,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });

    const res = await fetch(auth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const updated: StoredCredential = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cred.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };
    // Persist refreshed token
    saveCredential(auth.tokenUrl.split("/")[2] || "unknown", updated);
    return updated;
  } catch { return null; }
}
