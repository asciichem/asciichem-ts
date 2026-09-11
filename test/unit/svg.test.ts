import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import "../../src/index.js";

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
});
