// The mechanism step graph (the port of the reference's
// MechanismGraph and the Rust engine's mechanism_graph tests): each
// step's reaction re-parsed with the same grammar, catalysts (species
// on both sides of one step), links (an earlier step's product
// consumed as a later step's reactant), cascade entry/exit sides,
// coefficient-free matching, and prose entries kept as non-reactions.
// Also pins the renderer bytes element-for-element with the Ruby
// reference (the RS PR pinned the same bytes) and the wire round trip
// through a conditioned step.
import { describe, expect, it } from "vitest";
import { parseText } from "../../src/parser.js";
import { parse } from "../../src/index.js";
import { fromModelJSON } from "../../src/wire/from-wire.js";
import { Mechanism, MechanismGraphStep, Reaction } from "../../src/model.js";
import { renderMathml } from "../../src/formatter/mathml.js";
import { HtmlFormatter } from "../../src/formatter/html.js";
import { LatexFormatter } from "../../src/formatter/latex.js";
import { SvgFormatter } from "../../src/formatter/svg.js";
import { mechanismGraph } from "../../src/mechanism-graph.js";
import "../../src/index.js";

function graphFor(source: string): { steps: MechanismGraphStep[]; links: { from: string; to: string; species: string[] }[] } {
  const node = parse(source).nodes[0];
  if (!(node instanceof Mechanism)) throw new Error(`expected a mechanism node, got ${String(node)}`);
  return mechanismGraph(node);
}

function mechanismBody(lines: string[]): string {
  return `mechanism{\n  ${lines.join("\n  ")}\n}`;
}

function linkShapes(graph: ReturnType<typeof graphFor>): [string, string, string[]][] {
  return graph.links.map((link) => [link.from, link.to, link.species]);
}

describe("mechanism step graph", () => {
  it("parses each step value into a reaction", () => {
    const graph = graphFor(mechanismBody(["step1: A + B -> C"]));
    expect(graph.steps).toHaveLength(1);
    expect(graph.steps[0].label).toBe("step1");
    expect(graph.steps[0].reaction).toBeInstanceOf(Reaction);
    expect(graph.steps[0].catalysts).toEqual([]);
  });

  it("links a later step that consumes an earlier product", () => {
    const graph = graphFor(mechanismBody(["s1: A + B -> C", "s2: C -> D"]));
    expect(linkShapes(graph)).toEqual([["s1", "s2", ["C"]]]);
  });

  it("links chains transitively, step to step, not across gaps", () => {
    const graph = graphFor(mechanismBody(["s1: A -> B", "s2: B -> C", "s3: C -> D"]));
    expect(linkShapes(graph)).toEqual([
      ["s1", "s2", ["B"]],
      ["s2", "s3", ["C"]],
    ]);
  });

  it("does not link steps with no shared species", () => {
    const graph = graphFor(mechanismBody(["s1: A -> B", "s2: X -> Y"]));
    expect(graph.links).toEqual([]);
  });

  it("recognises a species on both sides of one step as a catalyst", () => {
    const graph = graphFor(mechanismBody(["s1: A + Pd -> B + Pd"]));
    expect(graph.steps[0].catalysts).toEqual(["Pd"]);
  });

  it("links through a shared catalyst species as well", () => {
    const graph = graphFor(mechanismBody(["s1: A + Pd -> B + Pd", "s2: Pd + C -> D"]));
    expect(graph.links.map((link) => link.species)).toEqual([["Pd"]]);
  });

  it("keeps prose entries as non-reactions with no links", () => {
    const graph = graphFor(mechanismBody(["s1: proton transfer", "s2: A -> B"]));
    expect(graph.steps[0].reaction).toBeNull();
    expect(graph.steps[1].reaction).toBeInstanceOf(Reaction);
    expect(graph.links).toEqual([]);
  });

  it("uses a cascade entry side and exit side for linking", () => {
    const graph = graphFor(mechanismBody(["s1: A -> B -> C", "s2: C -> D"]));
    expect(linkShapes(graph)).toEqual([["s1", "s2", ["C"]]]);
  });

  it("ignores coefficients when matching species", () => {
    const graph = graphFor(mechanismBody(["s1: 2A -> 3B", "s2: 2B -> C"]));
    expect(linkShapes(graph)).toEqual([["s1", "s2", ["B"]]]);
  });

  it("carries flows into the step graph", () => {
    const graph = graphFor(mechanismBody(["s1: A -> B | flow: A > B"]));
    expect(graph.steps[0].flows).toEqual([{ source: "A", target: "B" }]);
  });

  it("leaves the canonical text and model unchanged", () => {
    const source = mechanismBody(["s1: A -> B", "s2: B -> C"]);
    expect(parseText(source).toText()).toBe(source);
  });
});

// -- renderer bytes (element-for-element with the Ruby reference) --------

describe("mechanism renderer parity", () => {
  const input = "mechanism{\n  s1: A -> B | flow: A > B\n  spectator: Na^+\n}";

  it("mathml renders the step table byte-exact", () => {
    expect(renderMathml(parse(input))).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<math xmlns="http://www.w3.org/1998/Math/MathML">
  <mrow>
    <mrow>
      <mi mathvariant="normal">mechanism</mi>
      <mtable>
        <mtr>
          <mtd>
            <mi mathvariant="normal">s1</mi>
          </mtd>
          <mtd>
            <mtext>A -&gt; B</mtext>
          </mtd>
        </mtr>
        <mtr>
          <mtd>
            <mi mathvariant="normal">spectator</mi>
          </mtd>
          <mtd>
            <mtext>Na^+</mtext>
          </mtd>
        </mtr>
      </mtable>
    </mrow>
  </mrow>
</math>
`);
  });

  it("mathml renders a bare mechanism as the bare marker", () => {
    // The body-less forms build the empty mechanism (the model carries
    // no steps and no spectators), rendering as the bare marker.
    for (const bare of ["mechanism", "mechanism{}"]) {
      const out = renderMathml(parse(bare));
      expect(out).toContain('<mi mathvariant="normal">mechanism</mi>');
      expect(out).not.toContain("mtable");
      expect(parseText(bare).toText()).toBe("mechanism");
    }
  });

  it("html renders the steps definition list", () => {
    const out = new HtmlFormatter().render(parse(input));
    expect(out).toContain(
      '<span class="asciichem-mechanism"><dl class="asciichem-steps"><dt>s1</dt><dd>A -&gt; B</dd><dt>spectator</dt><dd>Na^+</dd></dl></span>',
    );
  });

  it("latex renders the step tabular", () => {
    const out = new LatexFormatter().render(parse(input));
    expect(out).toContain("\\text{mechanism}\\begin{tabular}{ll}\ns1 & A -> B \\\\\nspectator & Na^+ \\\\\n\\end{tabular}");
  });

  it("svg renders the full canonical text (never just the first line)", () => {
    const out = new SvgFormatter().render(parse(input));
    expect(out).toContain("mechanism{");
    expect(out).toContain("spectator: Na^+");
  });
});

// -- wire ------------------------------------------------------------------

describe("mechanism wire round trip", () => {
  it("round-trips flows, spectators, and a conditioned step", () => {
    const source =
      "mechanism{\n  s1: A-B -> A + B | flow: A-B > A; B > B-C\n  s2: 2C ->[cat: Pd] D\n  spectator: Na^+\n}";
    const formula = parse(source);
    const json = JSON.stringify(formula.toModelJSON());
    const round = fromModelJSON(json);
    expect(round.toText()).toBe(source);

    const wire = JSON.parse(json) as {
      nodes: [
        {
          steps: { flows?: { source: string; target: string }[]; reaction: { conditions?: { above?: string } } }[];
          spectators: { nodes: { charge?: string }[] }[];
        },
      ];
    };
    const steps = wire.nodes[0].steps;
    expect(steps[0].flows?.[0].source).toBe("A-B");
    expect(steps[0].flows?.[1].target).toBe("B-C");
    expect(steps[1].reaction.conditions?.above).toBe("cat: Pd");
    expect(wire.nodes[0].spectators[0].nodes[0].charge).toBe("+");
  });

  it("rejects a cascade step on the wire (no wire form — never flattened)", () => {
    // A cascade has no v1 wire form; the step body must be a plain
    // reaction. Direct wire JSON (not producible by this parser's
    // emission path) is the only way to arrive here.
    const wire = {
      type: "formula",
      nodes: [
        {
          type: "mechanism",
          steps: [
            {
              label: "s1",
              reaction: {
                type: "reaction-cascade",
                steps: [
                  { type: "reaction", reactants: [], products: [] },
                  { type: "reaction", reactants: [], products: [] },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(() => fromModelJSON(JSON.stringify(wire))).toThrow(/must be a reaction node/);
  });
});
