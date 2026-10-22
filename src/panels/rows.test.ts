/**
 * Pure row-helper tests (cli-blueprint.md §7.1, panels §6): dotted-path resolve,
 * the four fixed cell formats, and the in-memory `/` filter. No React, no I/O.
 */
import { describe, it, expect } from "vitest";
import { resolvePath, formatCell, filterRows } from "./rows.js";

describe("resolvePath", () => {
  it("reads a plain key and a dotted nested path", () => {
    expect(resolvePath({ a: 1 }, "a")).toBe(1);
    expect(resolvePath({ a: { b: { c: "x" } } }, "a.b.c")).toBe("x");
  });
  it("returns undefined for an absent path, never throws", () => {
    expect(resolvePath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(resolvePath(null, "a")).toBeUndefined();
    expect(resolvePath({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("formatCell", () => {
  const now = Date.UTC(2026, 0, 2, 0, 0, 0); // fixed clock
  it("relative-time renders s/m/h/d buckets", () => {
    expect(formatCell(now - 5_000, "relative-time", now)).toBe("5s");
    expect(formatCell(now - 5 * 60_000, "relative-time", now)).toBe("5m");
    expect(formatCell(now - 3 * 3_600_000, "relative-time", now)).toBe("3h");
    expect(formatCell(now - 2 * 86_400_000, "relative-time", now)).toBe("2d");
    expect(formatCell("", "relative-time", now)).toBe("");
  });
  it("bytes renders a human size", () => {
    expect(formatCell(512, "bytes")).toBe("512 B");
    expect(formatCell(1536, "bytes")).toBe("1.5 KiB");
    expect(formatCell(1_258_291, "bytes")).toBe("1.2 MiB");
  });
  it("count groups integers", () => {
    expect(formatCell(1234, "count")).toBe("1,234");
    expect(formatCell(0, "count")).toBe("0");
  });
  it("text and an unknown/absent format render verbatim", () => {
    expect(formatCell("hi", "text")).toBe("hi");
    expect(formatCell("hi", undefined)).toBe("hi");
    expect(formatCell(undefined, undefined)).toBe("");
  });
});

describe("filterRows", () => {
  const rows = [
    { name: "alpha", detail: "first" },
    { name: "beta", detail: "second" },
  ];
  const cols = [{ key: "name" }, { key: "detail" }];
  it("keeps every row for an empty query", () => {
    expect(filterRows(rows, cols, "")).toEqual(rows);
  });
  it("matches a case-insensitive substring over the visible columns", () => {
    expect(filterRows(rows, cols, "ALP")).toEqual([rows[0]]);
    expect(filterRows(rows, cols, "second")).toEqual([rows[1]]);
    expect(filterRows(rows, cols, "zzz")).toEqual([]);
  });
});
