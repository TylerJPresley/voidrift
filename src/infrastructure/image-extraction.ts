/**
 * Image Extraction — detects image paths in user input and loads them as base64 content blocks.
 * Infrastructure concern extracted from turn.ts.
 */
import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import type { ContentBlock } from "../session/context.js";

const IMAGE_PATH_REGEX = /(?:^|\s)((?:\.\/|\/|~\/)?[\w./_-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$)/gi;

export function extractImages(input: string, workspaceRoot: string): { text: string; contentBlocks: ContentBlock[] } {
  const blocks: ContentBlock[] = [];
  let text = input;

  const matches = [...input.matchAll(IMAGE_PATH_REGEX)];
  for (const match of matches) {
    const rawPath = match[1];
    const resolved = rawPath.startsWith("~/")
      ? join(process.env.HOME || "", rawPath.slice(2))
      : isAbsolute(rawPath)
        ? rawPath
        : join(workspaceRoot, rawPath);

    if (!existsSync(resolved)) continue;

    try {
      const data = readFileSync(resolved);
      const ext = resolved.split(".").pop()?.toLowerCase() || "png";
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      const base64 = data.toString("base64");
      blocks.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
      text = text.replace(rawPath, `[image: ${rawPath}]`);
    } catch {}
  }

  if (blocks.length) {
    blocks.unshift({ type: "text", text });
  }

  return { text, contentBlocks: blocks };
}
