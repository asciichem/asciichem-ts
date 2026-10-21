// Mechanism electron-flow markers (TODO.v2/13 item 4, slice 4c): a
// step value is its reaction followed by `| flow: SRC > DST` clauses.
// Unknown clauses are rejected, never dropped.
import { describe, expect, it } from "vitest";
import { fromModelJSON, parse, Mechanism, ParseError } from "../../src/index.js";

function mechanism(body: string): Mechanism {
  return parse(`mechanism{\n  ${body}\n}`).nodes[0] as Mechanism;
}

describe("mechanism electron-flow markers", () => {
  it("parses flow clauses into typed markers", () => {
    const step = mechanism("s1: A-B -> A + B | flow: A-B > A; B > B-C").steps[0];
    expect(step.reaction).toBe("A-B -> A + B");
    expect(step.flows.map((f) => [f.source, f.target])).toEqual([
      ["A-B", "A"],
      ["B", "B-C"],
    ]);
  });

  it("keeps steps without flows empty", () => {
    expect(mechanism("s1: A -> B").steps[0].flows).toEqual([]);
  });

  it("round-trips the canonical text exactly", () => {
    const source =
      "mechanism{\n  s1: A-B -> A + B | flow: A-B > A; B > B-C\n  s2: A + C -> A-C\n}";
    expect(parse(source).toText()).toBe(source);
  });

  it("rejects an unknown clause kind", () => {
    expect(() => mechanism("s1: A -> B | curve: A > B")).toThrow(ParseError);
  });

  it("rejects a malformed flow arrow", () => {
    expect(() => mechanism("s1: A -> B | flow: A >")).toThrow(ParseError);
  });

  it("emits flows on the wire", () => {
    const wire = mechanism("s1: A -> B | flow: A > B").toModelJSON() as {
      steps: { flows?: { source: string; target: string }[] }[];
    };
    expect(wire.steps[0].flows).toEqual([{ source: "A", target: "B" }]);
  });

  it("omits flows from the wire when a step has none", () => {
    const wire = mechanism("s1: A -> B").toModelJSON() as {
      steps: { flows?: unknown }[];
    };
    expect(wire.steps[0]).not.toHaveProperty("flows");
  });

  // Wire ingestion (TODO.v2/13 item 4): steps come back as canonical
  // reaction text, flows and spectators intact.
  it("round-trips through the wire form", () => {
    const body = [
      "s1: A-B -> A + B | flow: A-B > A; B > B-C",
      "s2: 2C ->[cat: Pd] D",
      "  spectator: Na^+",
    ].join("\n");
    const formula = parse(`mechanism{\n  ${body}\n}`);
    const text = formula.toText();
    const parsed = fromModelJSON(JSON.stringify(formula.toModelJSON())).nodes[0] as Mechanism;
    expect(parsed.toText()).toBe(text);
    expect(parsed.steps[0].flows.map((f) => [f.source, f.target])).toEqual([
      ["A-B", "A"],
      ["B", "B-C"],
    ]);
    expect(parsed.spectators).toEqual(["Na^+"]);
  });
});
