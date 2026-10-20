// Perception conformance (TODO.v2/13 item 2): implicit hydrogens and
// aromatic rings are shared semantics fixed by the corpus
// (fixtures/perception.json, generated from the Ruby reference).
// Skips silently when the corpus is not cloned next to this repo.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Molecule } from "../../src/model.js";
import { parseSmiles } from "../../src/smiles.js";
import { buildGraph } from "../../src/structure.js";
import { aromaticRings, hydrogenValenceSum, implicitHydrogens } from "../../src/perception.js";

interface PerceptionCase {
  id: string;
  smiles: string;
  perception: { implicitHydrogens: (number | null)[]; aromaticRings: number[][] };
}

function perceptionCases(): PerceptionCase[] {
  const dir = process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
  const file = join(dir, "corpus", "fixtures", "perception.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as PerceptionCase[];
}

const cases = perceptionCases();

function lexicographic(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

describe("perception conformance corpus", () => {
  it("has perception cases when the corpus is present", () => {
    if (cases.length > 0) expect(cases.length).toBeGreaterThanOrEqual(14);
  });

  cases.forEach((c) => {
    it(`${c.id}: perceives the shared implicit hydrogens`, () => {
      const molecule = parseSmiles(c.smiles).nodes[0] as Molecule;
      const { atoms, edges } = buildGraph(molecule);
      const hydrogens = atoms.map((atom, i) =>
        implicitHydrogens(atom, hydrogenValenceSum(i, edges)),
      );
      expect(hydrogens).toEqual(c.perception.implicitHydrogens);
    });

    it(`${c.id}: perceives the shared aromatic rings`, () => {
      const molecule = parseSmiles(c.smiles).nodes[0] as Molecule;
      const { atoms, edges } = buildGraph(molecule);
      const rings = aromaticRings(atoms, edges)
        .map((r) => [...r].sort((a, b) => a - b))
        .sort(lexicographic);
      expect(rings).toEqual(c.perception.aromaticRings);
    });
  });
});
