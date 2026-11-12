// Citation unit tests — the reference gem's citation spec semantics:
// profiles per source, the InChIKey-anchored identifier keywords, the
// provenance note (licence terms survive into the document), and the
// no-provenance rejection. The corpus's citation.json goldens gate the
// exact bytes; these tests pin the payload shapes behind them.
import { describe, expect, it } from "vitest";
import { Substance, buildBibitem, bibitemToXml, CitationError } from "../../src/index.js";

const PINNED = "2026-01-05T09:30:00Z";

function pubchemAspirin(): Substance {
  return Substance.fromWire({
    type: "substance-record",
    preferredName: "2-acetyloxybenzoic acid",
    formula: "C9H8O4",
    molecularWeight: 180.16,
    identifiers: [
      {
        identifier: { type: "identifier", value: "2244", convention: "pubchem-cid" },
        provenance: {
          type: "provenance",
          source: "pubchem",
          retrievedAt: PINNED,
          attribution: "PubChem, U.S. National Library of Medicine",
        },
      },
      {
        identifier: {
          type: "identifier",
          value: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
          convention: "inchikey",
        },
        provenance: {
          type: "provenance",
          source: "pubchem",
          retrievedAt: PINNED,
          attribution: "PubChem, U.S. National Library of Medicine",
        },
      },
    ],
  });
}

describe("bibitem payload", () => {
  it("profiles pubchem: NCBI publisher, compound link, CID docidentifier", () => {
    const payload = buildBibitem(pubchemAspirin());
    expect(payload.bibitemType).toBe("dataset");
    expect(payload.title).toBe(
      "2-acetyloxybenzoic acid - PubChem, U.S. National Library of Medicine substance record",
    );
    expect(payload.docidentifierType).toBe("pubchem");
    expect(payload.docidentifier).toBe("PubChem CID 2244");
    expect(payload.link).toBe("https://pubchem.ncbi.nlm.nih.gov/compound/2244");
    expect(payload.accessedOn).toBe("2026-01-05");
    expect(payload.keywords).toEqual([
      "pubchem-cid=2244",
      "inchikey=BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    ]);
    expect(payload.note).toBe("Retrieved from pubchem; PubChem, U.S. National Library of Medicine");
  });

  it("profiles common_chemistry: CAS publisher, detail link, CAS RN docidentifier", () => {
    const substance = Substance.fromWire({
      type: "substance-record",
      preferredName: "Aspirin",
      identifiers: [
        {
          identifier: { type: "identifier", value: "50-78-2", convention: "cas" },
          provenance: {
            type: "provenance",
            source: "common_chemistry",
            retrievedAt: PINNED,
            attribution: "CAS Common Chemistry (CC BY-NC 4.0)",
          },
        },
      ],
    });
    const payload = buildBibitem(substance);
    expect(payload.publisher).toBe("CAS Common Chemistry");
    expect(payload.link).toBe("https://commonchemistry.cas.org/detail?cas_rn=50-78-2");
    expect(payload.docidentifier).toBe("CAS RN 50-78-2");
    // The CC BY-NC line must survive into the rendered document.
    expect(payload.note).toBe("Retrieved from common_chemistry; CAS Common Chemistry (CC BY-NC 4.0)");
  });

  it("falls back to the substance's own provenance for unknown sources", () => {
    const substance = Substance.fromWire({
      type: "substance-record",
      identifiers: [
        {
          identifier: { type: "identifier", value: "50-78-2", convention: "cas" },
          provenance: {
            type: "provenance",
            source: "example",
            retrievedAt: PINNED,
            sourceVersion: "2026.11",
            attribution: "Example Data Source",
          },
        },
      ],
    });
    const payload = buildBibitem(substance);
    expect(payload.publisher).toBe("example");
    expect(payload.docidentifierType).toBe("example");
    expect(payload.docidentifier).toBe("cas: 50-78-2");
    expect(payload.link).toBeNull();
    expect(payload.note).toBe("Retrieved from example; version 2026.11; Example Data Source");
  });

  it("drops the note when it would say nothing beyond the source name", () => {
    const substance = Substance.fromWire({
      type: "substance-record",
      identifiers: [
        {
          identifier: { type: "identifier", value: "50-78-2", convention: "cas" },
          provenance: { type: "provenance", source: "example", retrievedAt: PINNED },
        },
      ],
    });
    expect(buildBibitem(substance).note).toBeNull();
  });

  it("rejects a substance without provenance — not citable", () => {
    const substance = new Substance("hand-built", [], "H2O", null, [], []);
    expect(() => buildBibitem(substance)).toThrow(CitationError);
    expect(() => buildBibitem(substance)).toThrow(
      "substance has no provenance - resolve it first (AsciiChem::Resolver)",
    );
  });

  it("falls back through the title base to Substance when nothing names it", () => {
    // No preferred name, no cas, no inchikey — the title base is the
    // "Substance" fallback.
    const anonymous = new Substance(
      null,
      [],
      null,
      null,
      [
        {
          value: "x",
          convention: "cid",
          provenance: { source: "example", retrievedAt: PINNED },
        },
      ],
      [],
    );
    expect(buildBibitem(anonymous).title).toContain("Substance - example substance record");
  });
});

describe("bibitem XML", () => {
  it("serializes the relaton element order through the leptris engine", async () => {
    const xml = await bibitemToXml(buildBibitem(pubchemAspirin()));
    // Byte-exact against the corpus golden (citation.json pins the
    // full string; these assertions pin the load-bearing shape).
    expect(xml.startsWith('<bibitem id="PubChemCID2244" type="dataset" schema-version="v1.5.6">')).toBe(true);
    const positions = [
      xml.indexOf("<title"),
      xml.indexOf("<uri"),
      xml.indexOf("<docidentifier"),
      xml.indexOf("<date"),
      xml.indexOf("<contributor"),
      xml.indexOf("<note"),
      xml.indexOf("<keyword"),
    ];
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(xml.endsWith("</bibitem>")).toBe(true);
    expect(xml.endsWith("\n")).toBe(false);
  });

  it("derives the bibitem id like relaton (word characters only)", async () => {
    const xml = await bibitemToXml(
      buildBibitem(
        Substance.fromWire({
          type: "substance-record",
          identifiers: [
            {
              identifier: { type: "identifier", value: "50-78-2", convention: "cas" },
              provenance: { type: "provenance", source: "example", retrievedAt: PINNED },
            },
          ],
        }),
      ),
    );
    expect(xml.startsWith('<bibitem id="cas50782"')).toBe(true);
  });

  it("escapes engine-side and keeps leaves inline", async () => {
    const xml = await bibitemToXml(
      buildBibitem(
        Substance.fromWire({
          type: "substance-record",
          identifiers: [
            {
              identifier: { type: "identifier", value: "a&b<c", convention: "cas" },
              provenance: { type: "provenance", source: "example", retrievedAt: PINNED },
            },
          ],
        }),
      ),
    );
    expect(xml).toContain("<vocab>cas=a&amp;b&lt;c</vocab>");
    expect(xml).toContain("  <docidentifier");
  });

  it("rejects a provenance-less substance at the XML door too", () => {
    const substance = new Substance("hand-built", [], "H2O", null, [], []);
    expect(() => buildBibitem(substance)).toThrow(CitationError);
  });
});
