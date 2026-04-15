/**
 * Abort mechanism for agent loops (REQ-D-13).
 */

export class AbortRequested extends Error {
  constructor() { super("Abort requested"); this.name = "AbortRequested"; }
}

let _abortRequested = false;
const _activeLoops = new Map<number, { close?: () => void }>();
let _nextId = 0;

export function requestAbort(): void {
  _abortRequested = true;
  for (const loop of _activeLoops.values()) {
    try { loop.close?.(); } catch { /* swallow */ }
  }
}

export function clearAbort(): void { _abortRequested = false; }
export function isAbortRequested(): boolean { return _abortRequested; }

export function registerLoop(loop: { close?: () => void }): number {
  const id = _nextId++;
  _activeLoops.set(id, loop);
  return id;
}

export function unregisterLoop(id: number): void { _activeLoops.delete(id); }

export async function abortAwareSleep(seconds: number): Promise<void> {
  const chunks = Math.ceil(seconds / 0.25);
  for (let i = 0; i < chunks; i++) {
    if (_abortRequested) throw new AbortRequested();
    await new Promise(r => setTimeout(r, 250));
  }
}
