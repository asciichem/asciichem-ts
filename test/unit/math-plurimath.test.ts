// Unit coverage for the plurimath math engine (src/math-plurimath.ts)
// — the optional math extra. When @plurimath/plurimath is installed
// (the plurimath-posture CI job installs it), embedded math renders
// byte-identically with the reference through the engine; when it is
// absent, the renderers degrade and the tests assert the degradation —
// a posture, never a failure.
import { describe, expect, it } from "vitest";
import "../../src/index.js";
import { plurimathAvailable, registerPlurimathMath } from "../../src/math-plurimath.js";
import { parseText } from "../../src/parser.js";
import { renderMathml } from "../../src/formatter/mathml.js";

const installed = plurimathAvailable();

describe("plurimath math engine", () => {
  it("detects the extra's installation posture", () => {
    // Whatever this environment says, the detection must agree with
    // reality (the posture is configuration, not a failure).
    expect(plurimathAvailable()).toBe(installed);
  });

  const degradation = {
    html: '<math><mtext>K_c = 1</mtext></math>',
    latex: "$K_c = 1$",
  };

  it.skipIf(installed)("degrades embedded math in the math-less posture", () => {
    const formula = parseText("`K_c = 1`");
    expect(formula.toHtml()).toContain(degradation.html);
    expect(formula.toLatex()).toBe(`\\ce{${degradation.latex}}`);
    expect(renderMathml(formula)).toContain("<mtext>K_c = 1</mtext>");
  });

  it.runIf(installed)("renders embedded math byte-identically with the reference", async () => {
    await registerPlurimathMath();
    const formula = parseText("`K_c = 1`");
    expect(formula.toLatex()).toBe("\\ce{$K_{c} = 1$}");
    expect(formula.toHtml()).toContain('displaystyle="true"');
    expect(formula.toHtml()).toContain("<msub>");
    // The gem's MathML-4 output (plurimath#477): displaystyle rides
    // <math>, no <mstyle> wrapper.
    expect(renderMathml(formula)).toContain('displaystyle="true"');
    expect(renderMathml(formula)).not.toContain("<mstyle");
  });
});
