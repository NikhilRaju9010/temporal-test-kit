import { describe, expect, it } from "vitest";
import { stripJsonLineComments } from "./jsonc.js";

describe("stripJsonLineComments", () => {
  it("strips a full-line comment", () => {
    const input = `{\n  // this is a comment\n  "a": 1\n}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ a: 1 });
  });

  it("strips a trailing comment after a value", () => {
    const input = `{\n  "a": 1 // trailing comment\n}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ a: 1 });
  });

  it("does not strip // that appears inside a string value", () => {
    const input = `{\n  "url": "https://example.com"\n}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ url: "https://example.com" });
  });

  it("does not strip // inside a string that appears after a real comment on an earlier line", () => {
    const input = `{\n  // a comment\n  "url": "https://example.com"\n}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ url: "https://example.com" });
  });

  it("handles escaped quotes inside strings without losing comment-stripping afterward", () => {
    const input = `{\n  "note": "she said \\"hi\\"" // comment\n}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ note: 'she said "hi"' });
  });

  it("leaves plain JSON with no comments untouched (still valid)", () => {
    const input = `{"a":1,"b":[1,2,3]}`;
    expect(JSON.parse(stripJsonLineComments(input))).toEqual({ a: 1, b: [1, 2, 3] });
  });
});
