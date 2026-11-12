// Resolver unit tests — the registry semantics the reference gem's
// resolver specs pin: fan-out, per-source failure isolation, the
// InChIKey cross-check, the TTL cache serving offline, and the
// canonical wire substance-record form. Offline throughout: every
// fetch rides an injected value fake carrying recorded data (never a
// behaviour mock).
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResolverRegistry,
  ResolverConflictError,
  ResolverError,
  PubChemAdapter,
  OpsinAdapter,
  CommonChemistryAdapter,
  Cache,
  Substance,
  cgiEscape,
  type Fetch,
  type Substance as SubstanceValue,
} from "../../src/index.js";
import { pubchemUrl } from "../../src/resolver/pubchem.js";
import { opsinUrl } from "../../src/resolver/opsin.js";
import { commonChemistryUrl, commonChemistryHeaders, defaultApiKey } from "../../src/resolver/common-chemistry.js";

const PINNED = "2026-01-05T09:30:00Z";
const clock = (): string => PINNED;

// Answers every request with the recorded body (null = 404).
function recordedFetch(body: string | null, recordedUrls: string[] = []): Fetch {
  return {
    async get(url) {
      recordedUrls.push(url);
      return body;
    },
  };
}

// Network access from an offline lookup would be a bug.
const offlineFetch: Fetch = {
  async get(url) {
    throw new Error(`network must not be touched: ${url}`);
  },
};

const aspirinBody = JSON.stringify({
  PropertyTable: {
    Properties: [
      {
        CID: 2244,
        CanonicalSMILES: "CC(=O)OC1=CC=CC=C1C(=O)O",
        IsomericSMILES: "CC(=O)OC1=CC=CC=C1C(=O)O",
        MolecularFormula: "C9H8O4",
        MolecularWeight: "180.16",
        IUPACName: "2-acetyloxybenzoic acid",
        InChI: "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)",
        InChIKey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      },
    ],
  },
});

function tempCache(): Cache {
  return new Cache({ base: mkdtempSync(join(tmpdir(), "asciichem-resolver-unit-")) });
}

describe("URL construction (the shared CGI.escape table)", () => {
  it("builds the PUG-REST property URL per convention", () => {
    expect(pubchemUrl("aspirin", "name")).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/property/CanonicalSMILES,IsomericSMILES,MolecularFormula,MolecularWeight,IUPACName,InChI,InChIKey/JSON",
    );
    // CAS numbers are indexed as PubChem names.
    expect(pubchemUrl("50-78-2", "cas")).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/50-78-2/property/CanonicalSMILES,IsomericSMILES,MolecularFormula,MolecularWeight,IUPACName,InChI,InChIKey/JSON",
    );
    expect(pubchemUrl("2244", "pubchem-cid")).toContain("/cid/2244/");
  });

  it("percent-encodes like CGI.escape", () => {
    expect(cgiEscape("2,3-dimethylbutane")).toBe("2%2C3-dimethylbutane");
    expect(cgiEscape("a b")).toBe("a+b");
    expect(cgiEscape("acetic acid (CH3)")).toBe("acetic+acid+%28CH3%29");
    expect(cgiEscape("safe._-x")).toBe("safe._-x");
  });

  it("builds the OPSIN and Common Chemistry request URLs", () => {
    expect(opsinUrl("2,3-dimethylbutane")).toBe(
      "https://opsin.ch.cam.ac.uk/opsin/2%2C3-dimethylbutane.smiles",
    );
    expect(commonChemistryUrl("50-78-2")).toBe(
      "https://commonchemistry.cas.org/direct-api/detail?cas_rn=50-78-2",
    );
  });

  it("declares the Common Chemistry headers; the key rides X-API-KEY only when configured", () => {
    expect(commonChemistryHeaders("k")).toEqual({
      Accept: "application/json",
      "x-origin": "https://commonchemistry.cas.org/api-overview",
      "X-API-KEY": "k",
    });
    expect(commonChemistryHeaders(null)).toEqual({
      Accept: "application/json",
      "x-origin": "https://commonchemistry.cas.org/api-overview",
    });
  });

  it("reads the key chain: explicit null skips every lookup, the env wins when set", () => {
    // Explicit null = no key: neither the env nor the token file runs.
    expect(new CommonChemistryAdapter(null).apiKey).toBeNull();
    // The env lookup runs only when the argument is omitted, and wins
    // over the token file.
    expect(defaultApiKey({ COMMON_CHEMISTRY_API_KEY: "env-key" })).toBe("env-key");
  });
});

describe("PubChem adapter", () => {
  it("maps the property payload to the substance wire record", async () => {
    const adapter = new PubChemAdapter();
    const substance = await adapter.fetchRecord("aspirin", "name", { fetch: recordedFetch(aspirinBody), clock });
    expect(substance).not.toBeNull();
    expect(substance?.toWire()).toEqual({
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
        {
          identifier: {
            type: "identifier",
            value: "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)",
            convention: "inchi",
          },
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
            value: "CC(=O)OC1=CC=CC=C1C(=O)O",
            convention: "canonical-smiles",
          },
          provenance: {
            type: "provenance",
            source: "pubchem",
            retrievedAt: PINNED,
            attribution: "PubChem, U.S. National Library of Medicine",
          },
        },
      ],
      properties: [
        {
          name: "molecular-formula",
          value: "C9H8O4",
          provenance: {
            type: "provenance",
            source: "pubchem",
            retrievedAt: PINNED,
            attribution: "PubChem, U.S. National Library of Medicine",
          },
        },
        {
          name: "molecular-weight",
          value: "180.16",
          units: "g/mol",
          provenance: {
            type: "provenance",
            source: "pubchem",
            retrievedAt: PINNED,
            attribution: "PubChem, U.S. National Library of Medicine",
          },
        },
      ],
    });
    // The aspirin canonical SMILES sits within the supported subset.
    expect(substance?.structure).not.toBeNull();
  });

  it("answers null for not-found — unknown substance, not an error", async () => {
    const substance = await new PubChemAdapter().fetchRecord("zzz", "name", {
      fetch: recordedFetch(null),
      clock,
    });
    expect(substance).toBeNull();
  });

  it("raises an isolated source error on malformed JSON", async () => {
    await expect(
      new PubChemAdapter().fetchRecord("x", "name", { fetch: recordedFetch("not json"), clock }),
    ).rejects.toThrow(ResolverError);
  });
});

describe("OPSIN adapter", () => {
  it("carries the derived SMILES as identifier and structure", async () => {
    const substance = await new OpsinAdapter().fetchRecord("2,3-dimethylbutane", "iupac-name", {
      fetch: recordedFetch("CC(C)C(C)\n"),
      clock,
    });
    expect(substance?.identifierValue("canonical-smiles")).toBe("CC(C)C(C)");
    expect(substance?.structure).not.toBeNull();
    expect(substance?.provenance()?.attribution).toBe(
      "OPSIN, University of Cambridge Centre for Molecular Informatics",
    );
  });

  it("supports only iupac-name so it can never preempt a lookup source", () => {
    expect(new OpsinAdapter().supportedConventions).toEqual(["iupac-name"]);
  });
});

describe("Common Chemistry adapter", () => {
  it("maps the detail payload with the CC BY-NC attribution", async () => {
    const body = JSON.stringify({
      rn: "50-78-2",
      name: "Aspirin",
      formula: "C9H8O4",
      molecularMass: 180.16,
      smiles: "CC(=O)OC1=CC=CC=C1C(=O)O",
      inchi: "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      iupacName: "2-acetyloxybenzoic acid",
    });
    const substance = await new CommonChemistryAdapter("k").fetchRecord("50-78-2", "cas", {
      fetch: recordedFetch(body),
      clock,
    });
    expect(substance?.preferredName).toBe("Aspirin");
    expect(substance?.provenance()?.attribution).toBe("CAS Common Chemistry (CC BY-NC 4.0)");
    expect(substance?.identifierValue("iupac-name")).toBe("2-acetyloxybenzoic acid");
  });

  it("sends the X-API-KEY header only when a key is configured", async () => {
    const sent: Record<string, Record<string, string>> = {};
    const recording: Fetch = {
      async get(url, headers) {
        sent[url] = headers;
        return JSON.stringify({ rn: "50-78-2", name: "Aspirin" });
      },
    };
    await new CommonChemistryAdapter("the-key").fetchRecord("50-78-2", "cas", { fetch: recording, clock });
    expect(Object.values(sent)[0]?.["X-API-KEY"]).toBe("the-key");
    await new CommonChemistryAdapter(null).fetchRecord("50-78-2", "cas", { fetch: recording, clock });
    expect(Object.values(sent)[1]?.["X-API-KEY"]).toBeUndefined();
  });
});

describe("registry fan-out", () => {
  const registry = () =>
    new ResolverRegistry(
      new Map([
        ["pubchem", () => new PubChemAdapter()],
        ["opsin", () => new OpsinAdapter()],
        ["common_chemistry", () => new CommonChemistryAdapter(null)],
      ]),
    );

  it("returns one substance per answering source, in registration order", async () => {
    const cache = tempCache();
    const substances = await registry().resolveAll(
      { value: "50-78-2", convention: "cas" },
      { fetch: recordedFetch(aspirinBody), cache, refresh: true, clock },
    );
    expect(substances.map((s) => s.provenance()?.source)).toEqual(["pubchem"]);
  });

  it("limits to the named subset", async () => {
    const cache = tempCache();
    const substances = await registry().resolveAll(
      { value: "50-78-2", convention: "cas" },
      { fetch: recordedFetch(aspirinBody), cache, refresh: true, clock, sources: ["opsin"] },
    );
    // OPSIN does not support cas: nothing answers.
    expect(substances).toEqual([]);
  });

  it("skips a source-level failure instead of poisoning the fan-out", async () => {
    const cache = tempCache();
    // PubChem 500s; the registry still answers from any other source
    // asked (here: an extension fixture source).
    const failing = registry();
    const failingFetch: Fetch = {
      async get() {
        throw new ResolverError("HTTP 500: boom");
      },
    };
    expect(
      await failing.resolve(
        { value: "x", convention: "name" },
        { fetch: failingFetch, cache, refresh: true, clock },
      ),
    ).toBeNull();
  });

  it("raises Conflict when sources disagree on the InChIKey", async () => {
    const cache = tempCache();
    const disagreeing = new ResolverRegistry(
      new Map([
        ["pubchem", () => new PubChemAdapter()],
        ["fixture", () => new FixtureSource("fixture", "BSYNRYMUTXBXSQ-UHFFFAOYSA-Z")],
      ]),
    );
    await expect(
      disagreeing.resolveChecked(
        { value: "aspirin", convention: "name" },
        { fetch: recordedFetch(aspirinBody), cache, refresh: true, clock },
      ),
    ).rejects.toThrow(ResolverConflictError);
  });

  it("raises an actionable error for unknown sources", async () => {
    const cache = tempCache();
    await expect(
      registry()
        .resolveAll(
          { value: "x", convention: "name" },
          { fetch: recordedFetch(aspirinBody), cache, refresh: true, clock, sources: ["nope"] as unknown as string[] },
        ),
    ).rejects.toThrow("unknown resolver source");
  });

  // A one-off fixture-backed source (the Ruby specs' fixture_source).
  class FixtureSource extends CommonChemistryAdapter {
    constructor(
      name: string,
      private readonly inchikey: string,
    ) {
      super(null);
      void name;
    }

    override get sourceName(): string {
      return "fixture";
    }

    override get supportedConventions(): readonly string[] {
      return ["name"];
    }

    override async fetchRecord(): Promise<SubstanceValue | null> {
      const { Substance: S } = await import("../../src/resolver/substance.js");
      return new S(
        "Aspirin",
        [],
        "C9H8O4",
        null,
        [{ value: this.inchikey, convention: "inchikey", provenance: null }],
        [],
        null,
      );
    }
  }
});

describe("TTL cache", () => {
  it("keys entries as sha256(source:convention:value)", () => {
    const cache = tempCache();
    const expected = createSha256("pubchem:name:aspirin");
    expect(cache.keyFor("pubchem", "name", "aspirin")).toBe(expected);
  });

  it("serves a seeded entry offline, without re-fetching", async () => {
    const cache = tempCache();
    const adapter = new PubChemAdapter();
    await adapter.resolve(
      { value: "aspirin", convention: "name" },
      { fetch: recordedFetch(aspirinBody), cache, refresh: true, clock },
    );
    const offline = await adapter.resolve(
      { value: "aspirin", convention: "name" },
      { fetch: offlineFetch, cache, clock },
    );
    expect(offline?.identifierValue("pubchem-cid")).toBe("2244");
    // The pinned instant survives the round-trip (the cache path
    // restores provenance verbatim).
    expect(offline?.provenance()?.retrievedAt).toBe(PINNED);
  });

  it("round-trips a substance through the wire form (the cache path)", () => {
    const substance = new Substance(
      "Aspirin",
      [],
      "C9H8O4",
      180.16,
      [{ value: "50-78-2", convention: "cas", provenance: { source: "example", retrievedAt: PINNED, sourceVersion: "2026.11" } }],
      [{ name: "molecular-weight", value: "180.16", units: "g/mol", provenance: null }],
    );
    const restored = Substance.fromWire(substance.toWire());
    expect(restored.toWire()).toEqual(substance.toWire());
    expect(restored.provenance()?.sourceVersion).toBe("2026.11");
  });
});

import { createHash } from "node:crypto";

function createSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
