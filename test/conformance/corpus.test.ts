// Shared-corpus conformance: runs the asciichem-tests fixtures against
// this implementation. Claimed levels (verified in CI with the corpus
// cloned next to this repo):
//   L0 emission + schema validation, L1 Text round-trip, plus the
//   parse/reject contract for every fixture case.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseText } from "../../src/parser.js";
import { ParseError } from "../../src/errors.js";
import "../../src/index.js";
import { wireValidator } from "./schemas.js";

interface Fixture {
  id: string;
  input: string;
  parses?: boolean;
  roundTrip?: boolean;
  [key: string]: unknown;
}

function corpusDir(): string {
  return process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
}

function loadFixtures(): Fixture[] {
  const dir = join(corpusDir(), "corpus", "fixtures");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture[])
    .filter((f) => typeof f.input === "string");
}

const available = existsSync(join(corpusDir(), "corpus", "fixtures"));

describe.skipIf(!available)("asciichem-tests corpus", () => {
  const fixtures = loadFixtures();
  const validate = wireValidator();

  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThan(200);
  });

  describe("parse/reject contract", () => {
    for (const fixture of fixtures) {
      it(`${fixture.id}: ${JSON.stringify(fixture.input).slice(0, 60)}`, () => {
        if (fixture.parses) {
          expect(() => parseText(fixture.input), fixture.id).not.toThrow();
        } else {
          expect(() => parseText(fixture.input), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  describe("L1 text round-trip", () => {
    for (const fixture of fixtures.filter((f) => f.roundTrip)) {
      it(fixture.id, () => {
        expect(parseText(fixture.input).toText()).toBe(fixture.input);
      });
    }
  });

  describe("L0 emission + schema validation", () => {
    for (const fixture of fixtures.filter((f) => f.parses)) {
      it(fixture.id, () => {
        const wire = parseText(fixture.input).toModelJSON();
        const result = validate(wire);
        expect(result, `${fixture.id}: ${result}`).toBe(true);
      });
    }
  });
});
