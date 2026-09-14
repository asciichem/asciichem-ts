import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { renderMathml } from "../../src/formatter/mathml.js";

describe("MathML formatter", () => {
  it("emits the reference MathML shape", () => {
    const xml = renderMathml(parseText("H_2O"));
    expect(xml).toContain("<msub>");
    expect(xml).toContain('mathvariant="normal">H<');
  });

  it("binds prefix isotopes to the atom", () => {
    const xml = renderMathml(parseText("^14C"));
    expect(xml).toContain("<mmultiscripts>");
    expect(xml).toContain("<mprescripts/>");
    expect(xml).toContain("<mn>14</mn>");
  });

  // Spec'd loss (TODO.impl/61): the reference embeds Plurimath
  // MathML for `...` embedded math; without an AsciiMath engine this
  // port degrades to <mtext> with the raw source.
  it("degrades embedded math to mtext until an engine lands", () => {
    const xml = renderMathml(parseText("`x^2 + 1`"));
    expect(xml).toContain("<mtext>x^2 + 1</mtext>");
  });
});
