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
import { parseSmiles, parseMolfile, writeMolfile } from "../../src/index.js";
import { renderMathml } from "../../src/formatter/mathml.js";
import { buildGraph } from "../../src/structure.js";
import "../../src/index.js";
import { wireValidator } from "./schemas.js";

interface Fixture {
  id: string;
  input?: string;
  smiles?: string;
  molfile?: string;
  parses?: boolean;
  roundTrip?: boolean;
  smilesRoundTrip?: boolean;
  molfileRoundTrip?: boolean;
  mathml?: string;
  atoms?: number;
  bonds?: number;
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
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture[]);
}

function fixturesInput(f: Fixture): string {
  return f.input as string;
}

const available = existsSync(join(corpusDir(), "corpus", "fixtures"));

describe.skipIf(!available)("asciichem-tests corpus", () => {
  const fixtures = loadFixtures();
  const validate = wireValidator();

  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThan(200);
  });

  describe("parse/reject contract", () => {
    for (const fixture of fixtures.filter((f) => typeof f.input === "string")) {
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
    for (const fixture of fixtures.filter((f) => f.roundTrip && typeof f.input === "string")) {
      it(fixture.id, () => {
        expect(parseText(fixture.input).toText()).toBe(fixture.input);
      });
    }
  });

  describe("L0 emission + schema validation", () => {
    for (const fixture of fixtures.filter((f) => f.parses && typeof f.input === "string")) {
      it(fixture.id, () => {
        const wire = parseText(fixturesInput(fixture)).toModelJSON();
        const result = validate(wire);
        expect(result, `${fixture.id}: ${result}`).toBe(true);
      });
    }
  });

  // Structure interchange (TODO.v2 09): distinct keys, opt-in levels.
  describe("SMILES ingestion", () => {
    for (const fixture of fixtures.filter((f) => typeof f.smiles === "string")) {
      it(fixture.id, () => {
        if (fixture.parses) {
          expect(() => parseSmiles(fixture.smiles as string), fixture.id).not.toThrow();
          if (fixture.smilesRoundTrip) {
            expect(
              parseSmiles(fixture.smiles as string).toSmiles(),
              fixture.id,
            ).toBe(fixture.smiles);
          }
        } else {
          expect(() => parseSmiles(fixture.smiles as string), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  describe("molfile ingestion", () => {
    for (const fixture of fixtures.filter((f) => typeof f.molfile === "string")) {
      it(fixture.id, () => {
        if (fixture.parses) {
          const molecule = parseMolfile(fixture.molfile as string);
          const { atoms, edges } = buildGraph(molecule);
          expect(atoms.length, fixture.id).toBe(fixture.atoms);
          expect(edges.length, fixture.id).toBe(fixture.bonds);
          if (fixture.molfileRoundTrip) {
            const shape = edges.map((e) => [e.from, e.to, e.kind]).sort();
            const reparsed = parseMolfile(writeMolfile(molecule));
            const again = buildGraph(reparsed);
            expect(again.atoms.length, fixture.id).toBe(atoms.length);
            expect(again.edges.map((e) => [e.from, e.to, e.kind]).sort(), fixture.id).toEqual(shape);
          }
        } else {
          expect(() => parseMolfile(fixture.molfile as string), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  // L2: MathML golden parity — exact-string comparison against the
  // reference implementation's output (single-contract rule).
  describe("L2 MathML golden", () => {
    for (const fixture of fixtures.filter((f) => typeof f.mathml === "string")) {
      it(fixture.id, () => {
        expect(renderMathml(parseText(fixture.input as string)), fixture.id).toBe(fixture.mathml);
      });
    }
  });
});
