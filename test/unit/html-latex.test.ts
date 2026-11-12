// Unit coverage for the HTML and LaTeX formatters — byte-exact mirrors
// of the Ruby reference visitors (lib/asciichem/formatter/{html,latex}.rb),
// arbitrated by the corpus's CLI family (`convert -t html|latex`) and
// extended here over the construct surface the CLI family doesn't pin.
import { describe, expect, it } from "vitest";
import "../../src/index.js"; // formatter registration
import { parseText } from "../../src/parser.js";
import { HtmlFormatter } from "../../src/formatter/html.js";
import { LatexFormatter } from "../../src/formatter/latex.js";

const html = (input: string): string => parseText(input).accept(new HtmlFormatter());
const latex = (input: string): string => parseText(input).accept(new LatexFormatter());

describe("HTML formatter", () => {
  // The corpus-pinned byte shape (cli/convert-html).
  it("renders H_2O exactly as the reference", () => {
    expect(html("H_2O")).toBe('<span class="asciichem">H<sub>2</sub>O</span>');
  });

  it("escapes the four XML-mandated characters in text", () => {
    expect(html('"a < b && c > d"')).toBe('<span class="asciichem">a &lt; b &amp;&amp; c &gt; d</span>');
  });

  it("renders charges and oxidation states as superscripts", () => {
    expect(html("Ca^2+")).toBe('<span class="asciichem">Ca<sup>2+</sup></span>');
    expect(html("Fe^(II)")).toBe('<span class="asciichem">Fe<sup>(II)</sup></span>');
  });

  it("renders isotopes as prefix superscripts", () => {
    expect(html("^14C")).toBe('<span class="asciichem"><sup>14</sup>C</span>');
  });

  it("renders groups with multiplied subscripts", () => {
    expect(html("Ca(OH)_2")).toBe('<span class="asciichem">Ca(OH)<sub>2</sub></span>');
  });

  it("renders reactions with the entity arrow and conditions", () => {
    expect(html("2H_2 + O_2 -> 2H_2O")).toBe(
      '<span class="asciichem">2H<sub>2</sub> + O<sub>2</sub> &gt;- 2H<sub>2</sub>O</span>'.replace("&gt;-", "→"),
    );
    expect(html("H_2 + O_2 ->[heat] 2H_2O")).toBe(
      '<span class="asciichem">H<sub>2</sub> + O<sub>2</sub> <sup>heat</sup>→ 2H<sub>2</sub>O</span>',
    );
  });

  it("renders electron configurations", () => {
    expect(html("1s^2 2s^2")).toBe('<span class="asciichem">1s<sup>2</sup> 2s<sup>2</sup></span>');
  });

  it("degrades embedded math to a math element carrying the source", () => {
    expect(html("`K_c = [P]/[R]`")).toBe(
      '<span class="asciichem"><math><mtext>K_c = [P]/[R]</mtext></math></span>',
    );
  });

  it("renders crystals with the semantic span hooks (inside the formula span)", () => {
    // Fractional coordinates are a text-only annotation (the reference's
    // Html#visit_atom spells none of them).
    expect(html('crystal[NaCl](a=5.64,alpha=90){Na@f(0,0,0)}')).toBe(
      '<span class="asciichem"><span class="asciichem-crystal"><span class="asciichem-name">[NaCl]</span>' +
        "<dl><dt>a</dt><dd>5.64</dd><dt>α</dt><dd>90</dd></dl>" +
        '<ol class="asciichem-atoms"><li>Na</li></ol></span></span>',
    );
  });
});

describe("LaTeX formatter", () => {
  // The corpus-pinned byte shape (cli/convert-latex).
  it("renders H_2O exactly as the reference", () => {
    expect(latex("H_2O")).toBe("\\ce{H2O}");
  });

  it("keeps one \\ce{} wrapper at the formula level", () => {
    expect(latex("CH_3-CH_2-OH")).toBe("\\ce{CH3-CH2-OH}");
  });

  it("spells triple bonds as \\equiv{}", () => {
    expect(latex("H#C-H")).toBe("\\ce{H\\equiv{}C-H}");
  });

  it("renders charges bare and oxidation states braced", () => {
    // mhchem wraps only non-alphanumeric superscripts — the reference's
    // `wrap` ("2+" carries a sign, so it braces).
    expect(latex("Ca^2+")).toBe("\\ce{Ca^{2+}}");
    expect(latex("Fe^(II)")).toBe("\\ce{Fe^{(II)}}");
  });

  it("renders reactions with arrow and conditions brackets", () => {
    expect(latex("H_2 + O_2 ->[heat] 2H_2O")).toBe("\\ce{H2 + O2 ->[heat] 2H2O}");
  });

  it("renders electron configurations in their own \\ce{} (the reference double-wraps)", () => {
    expect(latex("1s^2 2s^2")).toBe("\\ce{\\ce{1s^2 2s^2}}");
  });

  it("passes embedded math through as inline math", () => {
    expect(latex("`x^2`")).toBe("\\ce{$x^2$}");
  });

  it("renders crystals as \\text with a tabular body (inside the formula \\ce{})", () => {
    const output = latex("crystal[NaCl](a=5.64,alpha=90)");
    expect(output).toBe(
      "\\ce{\\text{crystal}[NaCl]\\begin{tabular}{ll}\na & 5.64 \\\\\n\\alpha & 90 \\\\\n\\end{tabular}}",
    );
  });

  it("keeps lone pairs and radicals", () => {
    expect(latex("::O")).toBe("\\ce{::O}");
    expect(latex("N.")).toBe("\\ce{N.}");
  });
});
