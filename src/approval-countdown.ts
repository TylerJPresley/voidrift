/**
 * Read the effective unattended-approval countdown (`limits.approval.autoDenySeconds`,
 * core-blueprint.md §9.5) from the core's limits view. 0 (the default) disables
 * the countdown; a non-zero value drives the `auto-deny in Ns` timer in the
 * single, batched and monitor approval dialogs. The live reader lives here (a `.ts`
 * module) rather than inline in the Ink `.tsx` host so the limits guard sees it.
 */
import type { CoreAPI } from "@voidrift/core";

export async function readAutoDenySeconds(api: CoreAPI): Promise<number> {
  const res = await api.config.limits();
  if (!res.ok) return 0;
  const limits = (res.value as { limits: { key: string; value: number }[] }).limits;
  const row = limits.find((l) => l.key === "approval.autoDenySeconds");
  return typeof row?.value === "number" ? row.value : 0;
}
