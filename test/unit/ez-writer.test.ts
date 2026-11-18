import { describe, expect, it } from "vitest";
import { writeMolfile } from "../../src/molfile.js";
import { parseSmiles } from "../../src/smiles.js";
import { Formula, Molecule } from "../../src/index.js";

// Directional bonds draw the E/Z layer: the substituent's side of the
// double-bond axis is the drawn information (read against the
// string-ordered axis — the chemomer lift's invariant). `C/C=C/C`
// draws trans, `C/C=C\C` cis; the oracle reads the corpus-exact /b
// signs off these drawings.
describe("directional-bond layout (the E/Z writer layer)", () => {
  function written(smiles: string): string {
    return writeMolfile((parseSmiles(smiles) as Formula).nodes[0] as Molecule);
  }

  function side(molfile: string, axisFrom: number, axisTo: number, substituent: number): number {
    const lines = molfile.split("\n");
    const coordinate = (index: number) => ({
      x: Number(lines[index + 4].slice(0, 10)),
      y: Number(lines[index + 4].slice(10, 20)),
    });
    const a = coordinate(axisFrom);
    const b = coordinate(axisTo);
    const u = coordinate(substituent);
    return (b.x - a.x) * (u.y - a.y) - (b.y - a.y) * (u.x - a.x);
  }

  function sides(smiles: string): [number, number] {
    const molfile = written(smiles);
    return [side(molfile, 1, 2, 0), side(molfile, 1, 2, 3)];
  }

  it("draws C/C=C/C trans: the substituents on opposite sides", () => {
    const [first, second] = sides("C/C=C/C");
    expect(first * second).toBeLessThan(0);
  });

  it("draws C/C=C\\C cis: the substituents on the same side", () => {
    const [first, second] = sides("C/C=C\\C");
    expect(first * second).toBeGreaterThan(0);
  });

  it("draws F/C=C/F trans and F/C=C\\F cis", () => {
    const [eFirst, eSecond] = sides("F/C=C/F");
    expect(eFirst * eSecond).toBeLessThan(0);
    const [zFirst, zSecond] = sides("F/C=C\\F");
    expect(zFirst * zSecond).toBeGreaterThan(0);
  });

  it("leaves models without directional bonds untouched", () => {
    expect(written("CCO")).toContain(" 1  2  1  0");
  });
});
