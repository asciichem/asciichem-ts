// Unit coverage for the CLI dispatch (src/cli.ts) — the contract shapes
// the corpus's cli.json family pins (exit codes, prefixed stderr
// families, stdout byte shapes), plus the seams the corpus leaves
// unpinned (the injected resolve/cite path, the engine flag, bare
// invocation). The corpus runner gates the corpus cases themselves;
// these cover the same contract locally and the rest of the surface.
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../../src/cli.js";
import { Cache, ResolverRegistry, Substance } from "../../src/index.js";
import type { Fetch } from "../../src/resolver/adapter.js";

// A capture harness: the corpus runner's in-process shape.
function capture(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    stdout: () => out,
    stderr: () => err,
  };
}

function run(argv: string[]) {
  const captured = capture();
  const code = async () => runCli(argv, captured.io);
  return { ...captured, code };
}

describe("convert", () => {
  it("defaults to mathml", async () => {
    const cli = run(["convert", "-i", "H_2O"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toContain("<math");
  });

  it("renders text byte-exactly", async () => {
    const cli = run(["convert", "-i", "H_2O", "-t", "text"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("H_2O\n");
  });

  it("renders the html and latex byte shapes", async () => {
    const cliHtml = run(["convert", "-i", "H_2O", "-t", "html"]);
    expect(await cliHtml.code()).toBe(0);
    expect(cliHtml.stdout()).toBe('<span class="asciichem">H<sub>2</sub>O</span>\n');
    const cliLatex = run(["convert", "-i", "H_2O", "-t", "latex"]);
    expect(await cliLatex.code()).toBe(0);
    expect(cliLatex.stdout()).toBe("\\ce{H2O}\n");
  });

  it("emits the model wire JSON", async () => {
    const cli = run(["convert", "-i", "H_2O", "-t", "model-json"]);
    expect(await cli.code()).toBe(0);
    expect(JSON.parse(cli.stdout())).toEqual({
      type: "formula",
      nodes: [
        {
          type: "molecule",
          nodes: [
            { type: "atom", element: "H", subscript: "2" },
            { type: "atom", element: "O" },
          ],
        },
      ],
    });
  });

  it("ingests SMILES through --from", async () => {
    const cli = run(["convert", "-i", "CCO", "--from", "smiles", "-t", "text"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("C-C-O\n");
  });

  it("maps parse errors to exit 1 with the prefixed stderr family", async () => {
    const cli = run(["convert", "-i", "   "]);
    expect(await cli.code()).toBe(1);
    expect(cli.stderr()).toContain("Parse error");
  });

  it("maps a missing input to the reference guidance", async () => {
    const cli = run(["convert"]);
    expect(await cli.code()).toBe(1);
    expect(cli.stderr()).toContain("provide -i INPUT or -f FILE");
  });

  it("maps unknown formats to exit 2 with the format family", async () => {
    const cli = run(["convert", "-i", "H", "-t", "wav"]);
    expect(await cli.code()).toBe(2);
    expect(cli.stderr()).toContain("Format error");
  });

  it("rejects unknown engines with exit 6", async () => {
    const cli = run(["convert", "-i", "H_2O", "--engine", "rdkit"]);
    expect(await cli.code()).toBe(6);
    expect(cli.stderr()).toContain("Engine error");
  });

  it("accepts the parsanol engine explicitly", async () => {
    const cli = run(["convert", "-i", "H_2O", "-t", "text", "--engine", "parsanol"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("H_2O\n");
  });

  it("renders CML after the dispatcher's engine warm-up", async () => {
    const cli = run(["convert", "-i", "H_2O", "-t", "cml"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toContain('<cml xmlns="http://www.xml-cml.org/schema">');
  });

  it("renders molfile output for molecules", async () => {
    const cli = run(["convert", "-i", "CCO", "--from", "smiles", "-t", "molfile"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toContain("V2000");
  });
});

describe("roundtrip", () => {
  it("passes canonical input through byte-exactly", async () => {
    const cli = run(["roundtrip", "-i", "H_2O"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("H_2O\n");
  });

  it("reports a mismatch with the reference stderr block", async () => {
    const cli = run(["roundtrip", "-i", "H2O"]);
    expect(await cli.code()).toBe(1);
    expect(cli.stderr()).toContain("round-trip mismatch");
    expect(cli.stdout()).toBe("");
  });
});

describe("lint", () => {
  it("reports findings with the [severity] Label: message shape", async () => {
    const cli = run(["lint", "-i", "H_2 + O_2 -> H_2O"]);
    expect(await cli.code()).toBe(1);
    expect(cli.stdout()).toContain("[error] Reaction: Reaction is not balanced: O: 2 vs 1");
  });

  it("stays silent and clean on a clean formula", async () => {
    const cli = run(["lint", "-i", "H_2O"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("");
  });

  it("emits the JSON payload (semantic, pretty-printed)", async () => {
    const cli = run(["lint", "-i", "H_2 + O_2 -> H_2O", "-f", "json"]);
    expect(await cli.code()).toBe(1);
    expect(JSON.parse(cli.stdout())).toEqual([
      { severity: "error", message: "Reaction is not balanced: O: 2 vs 1", node: "Reaction" },
    ]);
  });

  it("reports crystal sanity through the JSON node label", async () => {
    const cli = run(["lint", "-i", "crystal[x](a=-1){Na@f(0,0,0)}", "-f", "json"]);
    expect(await cli.code()).toBe(1);
    expect(JSON.parse(cli.stdout())).toEqual([
      { severity: "error", message: "Crystal a must be positive, got -1", node: "Crystal(x)" },
    ]);
  });
});

describe("validate", () => {
  it("columns the status report like the reference", async () => {
    const cli = run(["validate", "-i", 'H_2O @cas("7732-18-5") @cas("50-7-8")']);
    expect(await cli.code()).toBe(1);
    expect(cli.stdout()).toBe(
      "cas          7732-18-5                                ok\ncas          50-7-8                                   INVALID\n",
    );
  });

  it("reports the no-annotation posture", async () => {
    const cli = run(["validate", "-i", "H_2O"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("no identifier annotations found\n");
  });

  it("never exits non-zero on unknown conventions", async () => {
    const cli = run(["validate", "-i", 'H_2O @iupac("water")']);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toContain("unknown convention");
  });
});

describe("parse-cml", () => {
  it("reads the reference-shaped wire to text", async () => {
    const xml =
      '<cml xmlns="http://www.xml-cml.org/schema"><molecule id="m1"><atomArray>' +
      '<atom id="a1" elementType="H" count="2"/><atom id="a2" elementType="O"/>' +
      "</atomArray></molecule></cml>";
    const cli = run(["parse-cml", "-i", xml]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toBe("H_2O\n");
  });

  it("maps wire violations to the CML parse error family", async () => {
    const cli = run(["parse-cml", "-i", "<not-cml/>"]);
    expect(await cli.code()).toBe(1);
    expect(cli.stderr()).toContain("CML parse error");
  });
});

describe("version and tree", () => {
  it("prints the version line with the implementation's own version", async () => {
    const cli = run(["version"]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toMatch(/^asciichem \d+\.\d+\.\d+\n$/);
  });

  it("answers -v/--version identically", async () => {
    const dashV = run(["-v"]);
    expect(await dashV.code()).toBe(0);
    const long = run(["--version"]);
    expect(await long.code()).toBe(0);
    expect(dashV.stdout()).toBe(long.stdout());
  });

  it("prints the Thor-shaped command tree", async () => {
    const cli = run(["tree"]);
    expect(await cli.code()).toBe(0);
    const output = cli.stdout();
    expect(output).toContain("ascii_chem:cli\n");
    expect(output).toContain("├─ cite (Resolve a substance and emit a dataset-type Relaton bibitem (XML))");
    expect(output).toContain(
      "├─ convert (Convert INPUT to FORMAT (mathml|text|html|latex|svg|structural-svg|model-json|cml|smiles|molfile))",
    );
    expect(output).toContain("└─ version (Print the asciichem version)");
  });
});

describe("identity (engine-postured)", () => {
  it("fails with exit 5 guidance without an engine", async () => {
    const cli = run(["identity", "-i", "CCO", "--from", "smiles"]);
    const code = await cli.code();
    // The chemomer extra may legitimately be installed in a posture
    // run; both outcomes pin their own contract.
    if (code === 5) {
      expect(cli.stderr()).toContain("Identity error");
      expect(cli.stderr()).toMatch(/no InChI engine configured/);
    } else {
      expect(code).toBe(0);
      expect(cli.stdout()).toContain("InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3");
    }
  });

  it("demands exactly one molecule", async () => {
    const cli = run(["identity", "-i", "H_2O -> H_2O + H_2O"]);
    expect(await cli.code()).toBe(5);
    expect(cli.stderr()).toContain("identity derivation needs exactly one molecule, got 3");
  });
});

describe("resolve and cite (injected seams)", () => {
  // A value fake carrying a recorded substance — the replay pattern,
  // never behaviour mocking.
  const substanceWire = {
    type: "substance-record",
    preferredName: "water",
    identifiers: [
      {
        identifier: { type: "identifier", value: "7732-18-5", convention: "cas" },
        provenance: {
          type: "provenance",
          source: "pubchem",
          retrievedAt: "2026-01-05T09:30:00Z",
          attribution: "PubChem",
        },
      },
    ],
  };

  const deps = () => ({
    registry: new ResolverRegistry(
      new Map([
        [
          "pubchem",
          () => ({
            supports: (convention: string) => convention === "cas",
            async resolve() {
              return Substance.fromWire(substanceWire);
            },
          }),
        ],
      ]),
    ),
    fetch: { get: async () => null } as unknown as Fetch,
    cache: new Cache({ base: "/nonexistent-asciichem-cli-test" }),
  });

  it("resolve emits the model JSON by default", async () => {
    const cli = run(["resolve", "--cas", "7732-18-5"]);
    expect(await runCli(["resolve", "--cas", "7732-18-5"], cli.io, deps())).toBe(0);
    expect(JSON.parse(cli.stdout())).toMatchObject({ preferredName: "water" });
  });

  it("resolve -t text answers the preferred name", async () => {
    const cli = run(["resolve", "--cas", "7732-18-5", "-t", "text"]);
    expect(await runCli(["resolve", "--cas", "7732-18-5", "-t", "text"], cli.io, deps())).toBe(0);
    expect(cli.stdout()).toBe("water\n");
  });

  it("resolve without a selection exits 3", async () => {
    const cli = run(["resolve"]);
    expect(await runCli(["resolve"], cli.io, deps())).toBe(3);
    expect(cli.stderr()).toContain("Resolve error");
    expect(cli.stderr()).toContain("give one of --cas/--name/--cid/--inchikey/--smiles");
  });

  it("an unknown source exits 3 without touching the network", async () => {
    const cli = run(["resolve", "--cas", "7732-18-5", "--source", "nope"]);
    expect(await runCli(["resolve", "--cas", "7732-18-5", "--source", "nope"], cli.io, deps())).toBe(3);
    expect(cli.stderr()).toContain("unknown resolver source");
  });

  it("a source that does not know the value exits 3", async () => {
    const empty = {
      registry: new ResolverRegistry(
        new Map([
          [
            "pubchem",
            () => ({
              supports: () => true,
              async resolve() {
                return null;
              },
            }),
          ],
        ]),
      ),
      fetch: { get: async () => null } as unknown as Fetch,
      cache: new Cache({ base: "/nonexistent-asciichem-cli-test" }),
    };
    const cli = run(["resolve", "--cas", "50-7-8"]);
    expect(await runCli(["resolve", "--cas", "50-7-8"], cli.io, empty)).toBe(3);
    expect(cli.stderr()).toContain("pubchem does not know");
  });

  it("cite emits the dataset bibitem and exits 4 on rejection", async () => {
    const cli = run(["cite", "--cas", "7732-18-5"]);
    const code = await runCli(["cite", "--cas", "7732-18-5"], cli.io, deps());
    // A bibitem needs provenance-backed substance fields; the fake
    // carries a minimal record, so emission succeeds shape-wise.
    expect(code).toBe(0);
    expect(cli.stdout()).toContain("<bibitem");
    const noName = run(["cite", "--name", "x"]);
    expect(
      await runCli(["cite", "--name", "x"], noName.io, {
        registry: new ResolverRegistry(new Map()),
        fetch: { get: async () => null } as unknown as Fetch,
        cache: new Cache({ base: "/nonexistent-asciichem-cli-test" }),
      }),
    ).toBe(4);
    expect(noName.stderr()).toContain("unknown resolver source");
  });
});

describe("usage posture", () => {
  it("bare invocation prints the command list, exit 0", async () => {
    const cli = run([]);
    expect(await cli.code()).toBe(0);
    expect(cli.stdout()).toContain("Commands:");
  });

  it("unknown commands exit 1 on stderr", async () => {
    const cli = run(["frobnicate"]);
    expect(await cli.code()).toBe(1);
    expect(cli.stderr()).toContain("unknown command");
  });

  it("reads stdin on -i -", async () => {
    let out = "";
    const code = await runCli(["convert", "-i", "-", "-t", "text"], {
      out: (text) => {
        out += text;
      },
      err: () => {},
      stdin: () => "H_2O",
    });
    expect(code).toBe(0);
    expect(out).toBe("H_2O\n");
  });
});
