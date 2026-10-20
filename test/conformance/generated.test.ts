// Cross-implementation differential gate (TODO.v2/13 item 5): the
// generated cases come from the Ruby reference's property harness
// (asciichem-tests/corpus/generated/models.json — wire JSON plus
// canonical text, deterministic seed). This implementation must parse
// the wire into the model, render the exact canonical text, and
// re-parse to an equal wire form. Skips silently when the corpus is
// not cloned next to this repo (same convention as corpus.test.ts).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fromModelJSON } from "../../src/wire/from-wire.js";
import { toWireNode } from "../../src/wire/to-wire.js";
import { parseText } from "../../src/parser.js";
import "../../src/index.js";

interface GeneratedCase {
  wire: Record<string, unknown>;
  text: string;
}

function generatedCases(): GeneratedCase[] {
  const dir = process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
  const file = join(dir, "corpus", "generated", "models.json");
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as { cases: GeneratedCase[] }).cases;
}

const cases = generatedCases();

describe("generated differential conformance", () => {
  it("has generated cases when the corpus is present", () => {
    if (cases.length > 0) expect(cases.length).toBeGreaterThanOrEqual(300);
  });

  cases.forEach((c, i) => {
    it(`case ${i}: renders and re-parses identically`, () => {
      const formula = fromModelJSON(JSON.stringify(c.wire));
      if (i === 0) {
        const probe: any[] = [];
        const walk = (n: any) => {
          if (n.chirality) probe.push(n.chirality);
          (n.nodes ?? []).forEach(walk);
        };
        walk(formula);
        console.log("PROBE chirality:", JSON.stringify(probe));
      }
      expect(formula.toText()).toBe(c.text);
      const reparsed = parseText(c.text);
      expect(JSON.parse(JSON.stringify(toWireNode(reparsed)))).toEqual(c.wire);
    });
  });
});
