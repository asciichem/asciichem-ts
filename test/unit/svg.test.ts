import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { parseMolfile } from "../../src/molfile.js";
import { Formula } from "../../src/model.js";
import { StructuralSvgFormatter } from "../../src/formatter/structural-svg.js";
import "../../src/index.js";

const WEDGE_STEREO_MOLFILE =
  "2-butanol-wedge\n  fixture\n\n  5  4  0  0  0  0  0  0  0  0999 V2000\n   -1.5000    0.2500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.7500   -0.2500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    0.0000    0.2500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    0.7500   -0.2500    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0\n   -0.7500   -1.2500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  1  1  0  0  0  0  0  0  0\n  2  3  1  0  0  0  0  0  0  0  0\n  3  4  1  0  0  0  0  0  0  0  0\n  2  5  1  0  0  0  0  0  0  0  0\nM  END\n";

function structural(input: string): string {
  return parseText(input).toStructuralSvg();
}

describe("linear SVG", () => {
  it("renders water with true subscripts", () => {
    const svg = parseText("H_2O").toSvg();
    expect(svg).toMatch(/^<svg xmlns/);
    expect(svg).toContain("H");
    expect(svg).toContain('font-size="11.5"');
    expect(svg).toContain("2");
  });

  it("escapes XML in text nodes", () => {
    const svg = parseText('"a<b&c"').toSvg();
    expect(svg).toContain("a&lt;b&amp;c");
    expect(svg).not.toContain("<b&");
  });

  it("renders reactions with arrows and stacked conditions", () => {
    const svg = parseText("N_2 + 3H_2 <=>[Fe][500C] 2NH_3").toSvg();
    expect(svg).toContain("⇌");
    expect(svg).toContain("[Fe]");
    expect(svg).toContain("[500C]");
  });
});

describe("structural SVG", () => {
  it("renders cyclohexane as a hexagon", () => {
    const svg = parseText("C1-C-C-C-C-C1").toStructuralSvg();
    const polygons = [...svg.matchAll(/<line /g)].length;
    expect(polygons).toBe(6); // 5 chain bonds + 1 closure bond
    // Six carbons placed on a regular hexagon: verify all six labels.
    expect([...svg.matchAll(/>C</g)].length).toBe(6);
  });

  it("renders a linear chain as a zigzag", () => {
    const svg = parseText("H-O-H").toStructuralSvg();
    expect([...svg.matchAll(/<line /g)].length).toBe(2);
    expect(svg).toContain(">H<");
    expect(svg).toContain(">O<");
  });

  it("renders double and triple bonds as parallel lines", () => {
    const double = parseText("C=C").toStructuralSvg();
    expect([...double.matchAll(/<line /g)].length).toBe(2);
    const triple = parseText("C#C").toStructuralSvg();
    expect([...triple.matchAll(/<line /g)].length).toBe(3);
  });

  it("marks unmatched ring closures", () => {
    const svg = parseText("C1-C-C").toStructuralSvg();
    expect(svg).toContain("?");
  });

  it("falls back to typographic rendering for formula-only molecules", () => {
    // A formula is not a structure: C2H6O is ethanol OR dimethyl ether.
    const svg = parseText("C_2H_6O").toStructuralSvg();
    expect(svg).not.toContain("<line ");
    expect(svg).toContain("C");
  });

  it("produces deterministic output", () => {
    const first = parseText("C1-C-C-C-C-C1").toStructuralSvg();
    const second = parseText("C1-C-C-C-C-C1").toStructuralSvg();
    expect(first).toBe(second);
  });

  it("keeps molecule content inside the formula viewBox", () => {
    // Layout positions can be negative (the molecule's own viewBox
    // starts at its bound origin). The formula-level wrapper nests the
    // molecule viewport at the union offset, so the inner <svg> must
    // carry the molecule's viewBox — without it the raw coordinates
    // paint outside the outer viewBox and clip in HTML.
    const svg = parseText("C1-C-C-C-C-C1").toStructuralSvg();
    const inner = /<svg x="[^>]+>/.exec(svg)?.[0] ?? "";
    // The molecule's bound origin is negative; the inner viewport
    // carries it so the raw coordinates map inside the outer box.
    expect(inner).toMatch(/viewBox="-[\d.]+ -[\d.]+ 157 160"/);
    expect(svg).toContain('viewBox="0 0 157 160"');
  });

  it("maps each molecule's viewBox when nesting several", () => {
    // Two molecules in one formula: each viewport is placed at its
    // union offset and carries its own viewBox, so each child's raw
    // coordinates land inside its viewport.
    const water = parseText("H-O-H").nodes[0];
    const chain = parseText("C-C-C").nodes[0];
    const svg = new Formula([water, chain]).toStructuralSvg();
    const inners = [...svg.matchAll(/<svg x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" viewBox="([^"]+)"/g)];
    expect(inners.length).toBe(2);
    for (const [, vb] of inners) {
      // Each child carries its own (negative-origin) viewBox.
      expect(vb).toMatch(/^-[\d.]+ -[\d.]+ \d/);
    }
  });
});

describe("stereo wedge synthesis", () => {
  it("renders enantiomer pairs as distinguishable drawings", () => {
    // The enantiomer-pair test (asciichem-rs#82): the @ parity draws
    // its ligand away (hash), the @@ parity toward (wedge) — opposite
    // out-of-plane directions, never two identical flat drawings.
    const l = structural('@smiles("C[C@H](O)N")');
    const d = structural('@smiles("C[C@@H](O)N")');
    expect(l).not.toBe(d);
    expect(l).not.toContain("<polygon");
    expect(l).toMatch(/stroke-width="1\.2"/); // hash hatches
    expect(d).toContain("<polygon"); // wedge
    expect(d).not.toMatch(/stroke-width="1\.2"/);
  });

  it("synthesizes one wedge per stated-parity carbon on its first bond", () => {
    // l-alanine: the chiral carbon's first bond carries the glyph,
    // oriented centre → neighbour.
    const svg = structural('@smiles("N[C@@H](C)C(=O)O")');
    expect([...svg.matchAll(/<polygon /g)].length).toBe(1);
  });

  it("declines synthesis when the ligand set is not tetrahedral", () => {
    // C[C@H](O): the chiral carbon has two drawn neighbours + the
    // stated hydrogen — three ligands, no drawable tetrahedron, no
    // invented glyph.
    const svg = structural('@smiles("C[C@H](O)")');
    expect(svg).not.toContain("<polygon");
    expect(svg).not.toMatch(/stroke-width="1\.2"/);
  });

  it("leaves molecules without parity exactly as before", () => {
    const svg = structural("C-C(-O)-N");
    expect(svg).not.toContain("<polygon");
    expect(svg).not.toMatch(/stroke-width="1\.2"/);
  });

  it("draws authored wedges verbatim (no double synthesis)", () => {
    // The 2-butanol corpus molfile carries an authored up-wedge on
    // bond 1-2 and no atom parity — the renderer draws exactly the
    // authored glyph, nothing synthesized.
    const molecule = parseMolfile(WEDGE_STEREO_MOLFILE);
    const svg = new StructuralSvgFormatter().renderTop(molecule);
    expect([...svg.matchAll(/<polygon /g)].length).toBe(1);
  });
});
