/**
 * Pure input-index navigator tests (cli-blueprint.md §3.2, §3.3): axis
 * transitions, clamping, scratch discard, live buffer kept aside.
 */
import { describe, it, expect } from "vitest";
import { InputIndex } from "./input-index.js";
import { InputHistory } from "./history.js";

function seeded(entries: string[]): InputIndex {
  const h = new InputHistory();
  for (const e of entries) h.push(e); // pushed oldest→newest; all = newest-first
  return new InputIndex(h);
}

describe("§3.2/§3.3 input index — axis transitions", () => {
  it("Up walks 0→-1→-2 and shows newest-first history", () => {
    const nav = seeded(["first", "second"]); // all = ["second","first"]
    nav.setLive("draft");
    expect(nav.index).toBe(0);
    expect(nav.up()).toBe(-1);
    expect(nav.textAt()).toBe("second"); // -1 newest
    expect(nav.up()).toBe(-2);
    expect(nav.textAt()).toBe("first");
  });

  it("Down from a negative index walks back toward 0 and restores the live buffer", () => {
    const nav = seeded(["first", "second"]);
    nav.setLive("draft");
    nav.up();
    nav.up(); // at -2
    expect(nav.down()).toBe(-1);
    expect(nav.textAt()).toBe("second");
    expect(nav.down()).toBe(0);
    expect(nav.textAt()).toBe("draft"); // live buffer kept aside and restored
  });

  it("Down at 0 with no dropdown is a no-op; with candidates it walks 0→+1→+2", () => {
    const nav = seeded([]);
    nav.setLive("/he");
    expect(nav.down()).toBe(0); // no candidates: no-op
    nav.setCandidateCount(3);
    expect(nav.down()).toBe(1);
    expect(nav.down()).toBe(2);
    // positive text resolves from supplied labels (/{name} previews)
    expect(nav.textAt(["/help", "/health", "/hello"])).toBe("/health");
  });

  it("Up from +n walks back toward 0 and restores the live text", () => {
    const nav = seeded([]);
    nav.setLive("/he");
    nav.setCandidateCount(2);
    nav.down(); // +1
    expect(nav.up()).toBe(0);
    expect(nav.textAt(["/help", "/health"])).toBe("/he"); // live restored
  });
});

describe("§3.2/§3.3 input index — clamping", () => {
  it("clamps at the oldest history entry", () => {
    const nav = seeded(["only"]);
    expect(nav.up()).toBe(-1);
    expect(nav.up()).toBe(-1); // past oldest: stays put
  });

  it("clamps at the last candidate", () => {
    const nav = seeded([]);
    nav.setLive("/");
    nav.setCandidateCount(2);
    nav.down(); // +1
    nav.down(); // +2
    expect(nav.down()).toBe(2); // past the last candidate: stays put
  });

  it("a shrinking candidate list clamps a positive index that no longer fits", () => {
    const nav = seeded([]);
    nav.setCandidateCount(3);
    nav.down();
    nav.down();
    nav.down(); // +3
    nav.setCandidateCount(1);
    expect(nav.index).toBe(1);
    nav.setCandidateCount(0);
    expect(nav.index).toBe(0); // dropdown closed: back to live
  });
});

describe("§3.2 input index — scratch discard and immutable history", () => {
  it("an edit at -n is a scratch copy; moving away discards it and the entry reads as recorded", () => {
    const nav = seeded(["alpha", "beta"]); // all = ["beta","alpha"]
    nav.up();
    nav.up(); // at -2 = "alpha"
    nav.edit("alpha-edited");
    expect(nav.textAt()).toBe("alpha-edited");
    nav.up(); // clamped at oldest (-2) — same index, scratch kept
    expect(nav.textAt()).toBe("alpha-edited");
    nav.down(); // move to -1 — discards scratch
    nav.up(); // back to -2
    expect(nav.textAt()).toBe("alpha"); // reads as recorded
    expect(nav.historyStore.all).toEqual(["beta", "alpha"]); // immutable
  });

  it("Enter at -n submits the scratch (edited) text and resets to 0 with empty live", () => {
    const nav = seeded(["alpha", "beta"]);
    nav.setLive("draft");
    nav.up(); // -1 = beta
    nav.edit("beta-edited");
    expect(nav.submit()).toBe("beta-edited");
    expect(nav.index).toBe(0);
    expect(nav.textAt()).toBe(""); // live buffer emptied on submit
    // the edited text is pushed (dedupe/cap via InputHistory)
    expect(nav.historyStore.all[0]).toBe("beta-edited");
    // revisiting the original entry shows it unchanged
    nav.up(); // -1 = beta-edited (just pushed)
    nav.up(); // -2 = beta (original)
    expect(nav.textAt()).toBe("beta");
  });

  it("the live buffer is kept aside while visiting history and shown unchanged on return", () => {
    const nav = seeded(["x"]);
    nav.setLive("kept");
    nav.up();
    expect(nav.textAt()).toBe("x");
    nav.down();
    expect(nav.textAt()).toBe("kept");
  });

  it("accept places the previewed candidate into the live buffer at index 0", () => {
    const nav = seeded([]);
    nav.setLive("/he");
    nav.setCandidateCount(1);
    nav.down(); // +1
    nav.accept("/help");
    expect(nav.index).toBe(0);
    expect(nav.textAt()).toBe("/help");
  });
});
