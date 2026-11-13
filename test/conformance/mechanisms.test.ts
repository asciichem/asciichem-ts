// Mechanism electron-flow conformance (the corpus `flows` family):
// expected flow markers per step label, carried by the mechanism's
// steps (fixtures/mechanisms.json). The shared corpus runner gates
// parse/reject, L1 round-trip, and L0 emission for these fixtures;
// this file adds the family's deeper semantics gate — the same split
// the conditions family uses (conditions.test.ts). Skips silently
// when the corpus is not cloned next to this repo.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Mechanism } from "../../src/model.js";
import { parseText } from "../../src/parser.js";

interface MechanismCase {
  id: string;
  input: string;
  parses: boolean;
  flows: Record<string, { source: string; target: string }[]>;
}

function mechanismCases(): MechanismCase[] {
  const dir = process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
  const file = join(dir, "corpus", "fixtures", "mechanisms.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as MechanismCase[];
}

const cases = mechanismCases();

describe("mechanism flows conformance corpus", () => {
  it("has mechanism cases when the corpus is present", () => {
    if (cases.length > 0) expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  cases.forEach((c) => {
    it(`${c.id}: carries the shared electron-flow markers`, () => {
      expect(c.parses, `${c.id} must parse`).toBe(true);
      const mechanism = parseText(c.input).nodes[0] as Mechanism;
      const actual = Object.fromEntries(
        mechanism.steps.map((step) => [
          step.label,
          step.flows.map((f) => ({ source: f.source, target: f.target })),
        ]),
      );
      expect(actual).toEqual(c.flows);
    });
  });
});
