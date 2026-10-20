// Condition-entry conformance (TODO.v2/13 item 4, slice 1): typed
// `role: value` entries and free text are shared semantics fixed by
// the corpus (fixtures/conditions.json). Skips silently when the
// corpus is not cloned next to this repo.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Reaction } from "../../src/model.js";
import { parseText } from "../../src/parser.js";

interface ConditionsCase {
  id: string;
  input: string;
  conditionEntries: { role: string | null; value: string; side: string }[];
}

function conditionsCases(): ConditionsCase[] {
  const dir = process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
  const file = join(dir, "corpus", "fixtures", "conditions.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as ConditionsCase[];
}

const cases = conditionsCases();

describe("condition entries conformance corpus", () => {
  it("has condition cases when the corpus is present", () => {
    if (cases.length > 0) expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  cases.forEach((c) => {
    it(`${c.id}: derives the shared entries`, () => {
      const reaction = parseText(c.input).nodes[0] as Reaction;
      const entries = (reaction.conditions?.entries ?? []).map((e) => ({
        role: e.role,
        value: e.value,
        side: e.side,
      }));
      expect(entries).toEqual(c.conditionEntries);
    });
  });
});
