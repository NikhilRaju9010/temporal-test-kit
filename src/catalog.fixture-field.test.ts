import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "./catalog.js";

/**
 * `CatalogEntry.fixtureField` exists ONLY so `--list` can report
 * would-run/needs-fixture without executing any check — every
 * dynamic-fixture check ALSO independently names its own required field via
 * `missingFixtureResult(base, "...")` inside its own file. Two places
 * naming the same config path WILL drift if one is ever updated without
 * the other. This test is the thing that catches it: it reads each check
 * file as plain text (not importing/executing it) and compares the string
 * literal actually passed to `missingFixtureResult` against
 * `catalog.ts`'s own `fixtureField` for that same id — byte for byte.
 */
describe("catalog fixtureField matches what each check's own missingFixtureResult call actually reads", () => {
  const dynamicFixtureEntries = CATALOG.filter((c) => c.engine === "dynamic-fixture");

  it("every dynamic-fixture catalog entry declares a fixtureField", () => {
    for (const entry of dynamicFixtureEntries) {
      expect(entry.fixtureField, `${entry.id} is engine: "dynamic-fixture" but has no fixtureField`).toBeTruthy();
    }
  });

  it.each(dynamicFixtureEntries.map((e) => [e.id, e] as const))(
    "%s: catalog.fixtureField matches the check file's own missingFixtureResult(...) string",
    (id, entry) => {
      const checkPath = join(import.meta.dirname, "engines", "dynamic", "checks", `${id.toLowerCase()}.ts`);
      const source = readFileSync(checkPath, "utf-8");
      const match = source.match(/missingFixtureResult\(\s*base\s*,\s*"([^"]+)"/);

      expect(match, `${id}.ts has no missingFixtureResult(base, "...") call to compare against`).not.toBeNull();
      expect(
        match![1],
        `catalog.ts's fixtureField for ${id} ("${entry.fixtureField}") does not match ${id}.ts's own missingFixtureResult string ("${match![1]}")`,
      ).toBe(entry.fixtureField);
    },
  );
});
