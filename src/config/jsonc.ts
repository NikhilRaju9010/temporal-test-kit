/**
 * Strips `//` line comments from a JSON(C) string so it can be parsed with
 * plain `JSON.parse`. `temporal-test-kit init` generates a JSONC file (the
 * build spec's Appendix A template is commented throughout), so `loadConfig`
 * needs this to load one back without the dev having to strip comments by
 * hand first. Only `//` line comments are supported (no block-comment
 * syntax) — that's all the generated template ever uses, so anything more
 * would be speculative.
 *
 * Character-by-character, not a regex: a naive `/\/\/.*$/` strip would also
 * eat a `//` that legitimately appears inside a JSON string value (e.g. a
 * URL in `sampleInput`). This tracks whether the scan is currently inside a
 * string (and whether the next character is escaped) so `//` is only ever
 * treated as a comment start outside of one.
 */
export function stripJsonLineComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      output += "\n";
      continue;
    }

    output += ch;
  }

  return output;
}
