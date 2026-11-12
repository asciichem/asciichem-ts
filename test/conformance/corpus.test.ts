// Shared-corpus conformance: runs the asciichem-tests fixtures against
// this implementation. Claimed levels (verified in CI with the corpus
// cloned next to this repo):
//   L0 emission + schema validation, L1 Text round-trip, L2 MathML
//   golden, SMILES + molfile ingestion, the identifier validators, L4
//   linter diagnostics (engine-postured), the CML round-trip family,
//   and the parity families: resolver replay, citation bytes, and the
//   CLI (the offline command set, dispatched in-process).
//
// Family selection mirrors the reference runner: each fixture belongs
// to exactly one family, keyed by its distinguishing property
// (input/lint/convention/request/invocation), so families never double
// gate the same case.
import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parseText } from "../../src/parser.js";
import { ParseError } from "../../src/errors.js";
import { parseSmiles, parseMolfile, writeMolfile } from "../../src/index.js";
import { renderMathml } from "../../src/formatter/mathml.js";
import { buildGraph } from "../../src/structure.js";
import { validIdentifier } from "../../src/identifiers.js";
import { runLinter, type Diagnostic } from "../../src/linter.js";
import { inchiEngine } from "../../src/inchi.js";
import { initCml, parseCmlToFormula } from "../../src/cml.js";
import { runCli } from "../../src/cli.js";
import { chemomerAvailable, registerChemomerEngine } from "../../src/inchi-chemomer.js";
import {
  ResolverRegistry,
  PubChemAdapter,
  OpsinAdapter,
  CommonChemistryAdapter,
  Cache,
  DEFAULT_TTL_SECONDS,
  Substance,
  ResolverError,
  CitationError,
  citationXml,
  type Fetch,
  type Adapter,
} from "../../src/index.js";
import "../../src/index.js";
import { wireValidator, substanceRecordValidator } from "./schemas.js";

interface LintExpectation {
  severity: string;
  messageIncludes: string;
  node?: string;
}

interface ResolverExpectation {
  substance: Record<string, unknown> | null;
  structureParses?: boolean;
  outcome?: "resolved" | "skipped";
  cache?: { ttlSeconds?: number; keyFormula?: string; servesOffline?: boolean };
}

interface Fixture {
  id: string;
  input?: string;
  smiles?: string;
  molfile?: string;
  parses?: boolean;
  roundTrip?: boolean;
  smilesRoundTrip?: boolean;
  canonicalSmiles?: string;
  molfileRoundTrip?: boolean;
  cmlRoundTrip?: boolean;
  mathml?: string;
  atoms?: number;
  bonds?: number;
  // identifiers family
  convention?: string;
  value?: string;
  valid?: boolean;
  // linter family
  lint?: LintExpectation[];
  engine?: "none" | "inchi";
  pending?: string[];
  // resolver family
  source?: string;
  request?: { url: string; headers: Record<string, string> };
  response?: { status: number; body?: unknown };
  expectation?: ResolverExpectation;
  // citation family
  substance?: Record<string, unknown>;
  bibitem?: string;
  rejected?: boolean;
  // cli family
  invocation?: string[];
  exit?: number;
  stdout?: string;
  stdoutIncludes?: string[];
  stdoutJson?: unknown;
  stderrIncludes?: string[];
  [key: string]: unknown;
}

function corpusDir(): string {
  return process.env.ASCIICHEM_CORPUS ?? join(process.cwd(), "..", "asciichem-tests");
}

function loadFixtures(): Fixture[] {
  const dir = join(corpusDir(), "corpus", "fixtures");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture[]);
}

const available = existsSync(join(corpusDir(), "corpus", "fixtures"));

describe.skipIf(!available)("asciichem-tests corpus", () => {
  const fixtures = loadFixtures();
  const validate = wireValidator();
  const validateSubstance = substanceRecordValidator();

  // Family selection (the reference runner's exact split): parser
  // cases (input, minus the families owning their keys), the
  // identifier validators, L4 lint, the CML round-trip family, and the
  // parity families (resolver, citation, CLI), plus the structure
  // families (SMILES, molfile, perception — the last also gated in
  // detail by perception.test.ts).
  const parserCases = fixtures.filter(
    (f) =>
      typeof f.input === "string" &&
      f.lint === undefined &&
      f.convention === undefined &&
      f.cmlRoundTrip === undefined,
  );
  const identifierCases = fixtures.filter(
    (f) => typeof f.convention === "string" && typeof f.value === "string" && typeof f.valid === "boolean",
  );
  const lintCases = fixtures.filter((f) => Array.isArray(f.lint));
  const cmlCases = fixtures.filter((f) => f.cmlRoundTrip !== undefined);
  const resolverCases = fixtures.filter(
    (f) => typeof f.source === "string" && f.request !== undefined && f.expectation !== undefined,
  );
  const citationCases = fixtures.filter((f) => f.substance !== undefined && typeof f.bibitem === "string");
  const cliCases = fixtures.filter((f) => Array.isArray(f.invocation));
  const perceptionCases = fixtures.filter((f) => f.perception !== undefined);
  const smilesCases = fixtures.filter((f) => typeof f.smiles === "string" && f.perception === undefined);
  const molfileCases = fixtures.filter((f) => typeof f.molfile === "string");

  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThan(200);
  });

  it("every fixture lands in exactly one family", () => {
    const families = [
      parserCases,
      identifierCases,
      lintCases,
      cmlCases,
      resolverCases,
      citationCases,
      cliCases,
      perceptionCases,
      smilesCases,
      molfileCases,
    ];
    const total = families.reduce((sum, list) => sum + list.length, 0);
    expect(total, "unclassified fixtures exist").toBe(fixtures.length);
    const seen = new Set<string>();
    for (const list of families) {
      for (const fixture of list) {
        expect(seen.has(fixture.id), `${fixture.id} classified twice`).toBe(false);
        seen.add(fixture.id);
      }
    }
  });

  describe("parse/reject contract", () => {
    for (const fixture of parserCases) {
      it(`${fixture.id}: ${JSON.stringify(fixture.input).slice(0, 60)}`, () => {
        if (fixture.parses) {
          expect(() => parseText(fixture.input as string), fixture.id).not.toThrow();
        } else {
          expect(() => parseText(fixture.input as string), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  describe("L1 text round-trip", () => {
    for (const fixture of parserCases.filter((f) => f.roundTrip)) {
      it(fixture.id, () => {
        expect(parseText(fixture.input as string).toText()).toBe(fixture.input);
      });
    }
  });

  describe("L0 emission + schema validation", () => {
    for (const fixture of parserCases.filter((f) => f.parses)) {
      it(fixture.id, () => {
        const wire = parseText(fixture.input as string).toModelJSON();
        const result = validate(wire);
        expect(result, `${fixture.id}: ${result}`).toBe(true);
      });
    }
  });

  // Structure interchange (TODO.v2 09): distinct keys, opt-in levels.
  describe("SMILES ingestion", () => {
    for (const fixture of [...smilesCases, ...perceptionCases]) {
      it(fixture.id, () => {
        if (fixture.parses) {
          expect(() => parseSmiles(fixture.smiles as string), fixture.id).not.toThrow();
          if (fixture.smilesRoundTrip) {
            expect(
              parseSmiles(fixture.smiles as string).toSmiles(),
              fixture.id,
            ).toBe(fixture.smiles);
          }
        } else {
          expect(() => parseSmiles(fixture.smiles as string), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  describe("molfile ingestion", () => {
    for (const fixture of molfileCases) {
      it(fixture.id, () => {
        if (fixture.parses) {
          const molecule = parseMolfile(fixture.molfile as string);
          const { atoms, edges } = buildGraph(molecule);
          expect(atoms.length, fixture.id).toBe(fixture.atoms);
          expect(edges.length, fixture.id).toBe(fixture.bonds);
          if (fixture.molfileRoundTrip) {
            const shape = edges.map((e) => [e.from, e.to, e.kind]).sort();
            const reparsed = parseMolfile(writeMolfile(molecule));
            const again = buildGraph(reparsed);
            expect(again.atoms.length, fixture.id).toBe(atoms.length);
            expect(again.edges.map((e) => [e.from, e.to, e.kind]).sort(), fixture.id).toEqual(shape);
          }
        } else {
          expect(() => parseMolfile(fixture.molfile as string), fixture.id).toThrow(ParseError);
        }
      });
    }
  });

  // L2: MathML golden parity — exact-string comparison against the
  // reference implementation's output (single-contract rule).
  describe("L2 MathML golden", () => {
    for (const fixture of fixtures.filter((f) => typeof f.mathml === "string")) {
      it(fixture.id, () => {
        expect(renderMathml(parseText(fixture.input as string)), fixture.id).toBe(fixture.mathml);
      });
    }
  });

  // Identifier fixtures: the offline validator must agree with `valid`.
  describe("identifier validation", () => {
    for (const fixture of identifierCases) {
      it(`${fixture.id}: ${fixture.convention} ${JSON.stringify(fixture.value)}`, () => {
        expect(validIdentifier(fixture.convention as string, fixture.value as string), fixture.id).toBe(
          fixture.valid,
        );
      });
    }
  });

  // L4: linter diagnostics. Engine posture: the identity cross-check
  // is engine-scaled; this implementation's posture is whether the
  // chemomer engine extra is installed (never a hard dependency — the
  // posture is configuration, detected synchronously and registered
  // here so the cross-check sees a live engine in posture runs). A
  // case whose posture marker differs skips and reports — a missing
  // engine is a posture, not a failure.
  describe("L4 linter diagnostics", () => {
    const posture: "none" | "inchi" = chemomerAvailable() ? "inchi" : "none";
    beforeAll(async () => {
      if (posture === "inchi") await registerChemomerEngine();
    });
    const skippedByPosture: string[] = [];

    const matchesExpectation = (diagnostic: Diagnostic, expected: LintExpectation): boolean =>
      diagnostic.severity === expected.severity &&
      diagnostic.message.includes(expected.messageIncludes) &&
      (expected.node === undefined || diagnostic.label === expected.node);

    for (const fixture of lintCases) {
      const engineMarked = fixture.engine;
      const runsHere = engineMarked === undefined || engineMarked === posture;
      if (!runsHere) skippedByPosture.push(fixture.id);
      it.runIf(runsHere)(fixture.id, () => {
        if (fixture.parses === false) {
          expect(() => parseText(fixture.input as string), fixture.id).toThrow(ParseError);
          return;
        }
        expect(fixture.parses, `${fixture.id} must parse`).toBe(true);
        const formula = parseText(fixture.input as string);
        const actual = runLinter(
          formula,
          posture === "inchi" ? { engine: inchiEngine() ?? undefined } : {},
        );
        const expected = fixture.lint ?? [];
        // Bidirectional match: every expectation hits an actual, every
        // actual is hit by an expectation. lint: [] demands a clean run.
        for (const expectation of expected) {
          expect(
            actual.some((diagnostic) => matchesExpectation(diagnostic, expectation)),
            `${fixture.id}: no actual diagnostic matches ${JSON.stringify(expectation)}; got ${JSON.stringify(actual)}`,
          ).toBe(true);
        }
        for (const diagnostic of actual) {
          expect(
            expected.some((expectation) => matchesExpectation(diagnostic, expectation)),
            `${fixture.id}: unexpected diagnostic ${JSON.stringify(diagnostic.toString())}`,
          ).toBe(true);
        }
      });
    }

    it("reports the posture-skipped cases", () => {
      // The skip is part of the report, never silent: every
      // posture-marked case that did not run is listed here, and the
      // list changes only when the corpus's posture markers change.
      const corpusSkipped = lintCases
        .filter((f) => f.engine !== undefined && f.engine !== posture)
        .map((f) => f.id);
      expect(skippedByPosture).toEqual(corpusSkipped);
      if (posture === "none") {
        expect(skippedByPosture.length).toBeGreaterThan(0);
      }
    });
  });

  // Resolver family: replay the recorded request/response through the
  // real source adapter — the adapter must build exactly request.url,
  // send the adapter-declared headers ({api-key} is the caller's key
  // placeholder), and answer the expectation's substance wire record
  // with the pinned retrievedAt. The cache markers pin the shared
  // caching contract.
  describe("resolver replay", () => {
    // The pinned retrievedAt rides the fixture's expectation; a
    // fixture without one has no honest clock — replay fails loudly
    // rather than stamping the wall clock.
    const replayClock = (pinned: string | undefined): (() => string) => (): string => {
      if (pinned === undefined) {
        throw new Error("replay clock must come from the fixture's pinned retrievedAt");
      }
      return pinned;
    };

    const pinnedRetrievedAt = (fixture: Fixture): string | undefined =>
      (
        fixture.expectation?.substance as
          | { identifiers?: { provenance?: { retrievedAt?: string } }[] }
          | null
      )?.identifiers?.[0]?.provenance?.retrievedAt;

    // A replay fetch that asserts the adapter's request and answers
    // the recorded response. A value fake carrying data, never
    // behaviour mocking.
    const replayFetchFor = (fixture: Fixture, configuredKey: string | null): { fetch: Fetch; requests: { url: string; headers: Record<string, string> }[] } => {
      const requests: { url: string; headers: Record<string, string> }[] = [];
      const status = fixture.response?.status ?? 200;
      return {
        requests,
        fetch: {
          async get(url, headers) {
            requests.push({ url, headers });
            expect(url, `${fixture.id}: adapter URL`).toBe(fixture.request?.url);
            const declared = fixture.request?.headers ?? {};
            for (const [name, value] of Object.entries(declared)) {
              if (value === "{api-key}") {
                // The caller's key placeholder: the header is sent when
                // a key is configured, and never as the literal.
                if (configuredKey !== null) {
                  expect(headers[name], `${fixture.id}: api key header`).toBe(configuredKey);
                } else {
                  expect(headers[name], `${fixture.id}: key header without a key`).toBeUndefined();
                }
              } else {
                expect(headers[name], `${fixture.id}: header ${name}`).toBe(value);
              }
            }
            const undeclared = Object.keys(headers).filter(
              (name) => name !== "User-Agent" && !(name in declared),
            );
            expect(undeclared, `${fixture.id}: undeclared headers`).toEqual([]);
            if (status === 404) return null;
            if (status !== 200) throw new ResolverError(`HTTP ${status}: replay`);
            const body = fixture.response?.body;
            return typeof body === "string" ? body : JSON.stringify(body);
          },
        },
      };
    };

    for (const fixture of resolverCases) {
      it(`${fixture.id}: ${fixture.source}/${fixture.convention} ${JSON.stringify(fixture.value)}`, async () => {
        const clock = replayClock(pinnedRetrievedAt(fixture));
        const keyConfigured = (fixture.request?.headers?.["X-API-KEY"] ?? "").includes("{api-key}");
        const apiKey = keyConfigured ? "replay-test-key" : null;

        const adapter: Adapter =
          fixture.source === "pubchem"
            ? new PubChemAdapter()
            : fixture.source === "opsin"
              ? new OpsinAdapter()
              : new CommonChemistryAdapter(apiKey);

        const cacheDir = mkdtempSync(join(tmpdir(), "asciichem-resolver-replay-"));
        const cache = new Cache({ base: cacheDir });
        const replay = replayFetchFor(fixture, apiKey);
        let substance: Substance | null = null;
        let rejected: unknown = null;
        try {
          substance = await adapter.resolve(
            { value: fixture.value as string, convention: fixture.convention as string },
            { fetch: replay.fetch, cache, refresh: true, clock },
          );
        } catch (error) {
          rejected = error;
        }

        const expectation = fixture.expectation ?? {};
        if (expectation.outcome === "skipped") {
          // A skipped outcome is a source-level rejection — dropped by
          // the registry fan-out, never a poison.
          expect(rejected, `${fixture.id}: the skipped outcome is a source-level rejection`).toBeInstanceOf(
            ResolverError,
          );
          expect(substance, `${fixture.id}: skipped source answers nothing`).toBeNull();
        } else {
          expect(rejected, `${fixture.id}: unexpected rejection ${String(rejected)}`).toBeNull();
          expect(substance, `${fixture.id}: resolved`).not.toBeNull();
          // L0: the substance wire validates against the
          // asciichem-model v1 substance-record schema, then compares
          // semantically (key order cannot fail).
          const wire = substance?.toWire();
          const schemaResult = validateSubstance(wire);
          expect(schemaResult, `${fixture.id}: ${schemaResult}`).toBe(true);
          expect(wire, fixture.id).toEqual(expectation.substance);
          if (expectation.structureParses) {
            expect(substance?.structure, `${fixture.id}: source SMILES parses in the supported subset`).not.toBeNull();
          } else if (expectation.structureParses === false) {
            expect(substance?.structure, `${fixture.id}: structure stays an identifier`).toBeNull();
          }
        }

        // The cache markers pin the shared caching contract.
        const cacheContract = expectation.cache ?? {};
        if (cacheContract.ttlSeconds !== undefined) {
          expect(DEFAULT_TTL_SECONDS, `${fixture.id}: ttl`).toBe(cacheContract.ttlSeconds);
        }
        if (cacheContract.keyFormula !== undefined) {
          expect(
            cache.keyFor(fixture.source as string, fixture.convention as string, fixture.value as string),
            `${fixture.id}: ${cacheContract.keyFormula}`,
          ).toBe(createHash("sha256").update(`${fixture.source}:${fixture.convention}:${fixture.value}`).digest("hex"));
        }
        if (cacheContract.servesOffline) {
          // A seeded entry answers without re-fetching — and without a
          // key, for key-gated sources. The cache was written by the
          // resolution above; a network-touching fetch would throw.
          const cached = await cache.read(cache.keyFor(fixture.source as string, fixture.convention as string, fixture.value as string));
          if (cached !== null) {
            const offline = await adapter.resolve(
              { value: fixture.value as string, convention: fixture.convention as string },
              {
                fetch: { get: async (url) => Promise.reject(new Error(`network must not be touched: ${url}`)) },
                cache,
                clock,
              },
            );
            expect(offline, `${fixture.id}: serves offline`).not.toBeNull();
          }
        }
      });
    }

    it("a skipped source does not poison the others (registry fan-out)", async () => {
      const resolverCase = resolverCases.find((f) => f.expectation?.outcome === "skipped");
      const answeredCase = resolverCases.find(
        (f) => f.source === "pubchem" && f.expectation?.outcome !== "skipped",
      );
      if (resolverCase === undefined || answeredCase === undefined) return;

      const clock = replayClock(pinnedRetrievedAt(answeredCase));
      const cache = new Cache({ base: mkdtempSync(join(tmpdir(), "asciichem-resolver-fanout-")) });

      const registry = new ResolverRegistry(
        new Map([
          ["common_chemistry", () => new CommonChemistryAdapter(null)],
          ["pubchem", () => new PubChemAdapter()],
        ]),
      );
      const fetches: Record<string, Fixture["response"]> = {
        common_chemistry: resolverCase.response,
        pubchem: answeredCase.response,
      };
      const fetch: Fetch = {
        async get(url) {
          const source = url.includes("commonchemistry") ? "common_chemistry" : url.includes("pubchem") ? "pubchem" : "";
          const response = fetches[source];
          if (response === undefined) throw new Error(`no replay for ${url}`);
          if (response.status !== 200) throw new ResolverError(`HTTP ${response.status}: replay`);
          return JSON.stringify(response.body);
        },
      };
      const answered = await registry.resolveAll(
        { value: "50-78-2", convention: "cas" },
        { fetch, cache, refresh: true, clock },
      );
      expect(answered.map((s) => s.provenance()?.source)).toEqual(["pubchem"]);
    });
  });

  // Citation family: the emitted bibitem is byte-equal to the golden
  // (no trailing newline); a rejected case (no provenance) must throw.
  describe("citation goldens", () => {
    for (const fixture of citationCases) {
      it(fixture.id, async () => {
        const substance = Substance.fromWire(fixture.substance as Parameters<typeof Substance.fromWire>[0]);
        if (fixture.rejected) {
          await expect(citationXml(substance), fixture.id).rejects.toThrow(CitationError);
          return;
        }
        expect(await citationXml(substance), fixture.id).toBe(fixture.bibitem);
      });
    }
  });

  // CLI family: the corpus covers the offline command set; each case
  // runs `invocation` (the argv after the program name) against the
  // in-process dispatch and asserts exit plus the stdout/stderr
  // matchers (exact `stdout`, substring `stdoutIncludes`, semantic
  // `stdoutJson`, substring `stderrIncludes`). The "{version}"
  // placeholder in a matcher stands for this implementation's own
  // version. The corpus pre-excuses implementations per case
  // (`pending`); asciichem-ts is pre-excused for none — and if a
  // corpus-side CLI addition lands, the family-coverage report above
  // fails until this runner acknowledges it.
  describe("CLI contract", () => {
    const version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string;
    const substitute = (text: string): string => text.replaceAll("{version}", version);

    const dispatch = async (
      fixture: Fixture,
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      let stdout = "";
      let stderr = "";
      const code = await runCli(fixture.invocation ?? [], {
        out: (text) => {
          stdout += text;
        },
        err: (text) => {
          stderr += text;
        },
        stdin: () => {
          throw new Error(`${fixture.id}: the corpus carries no stdin cases`);
        },
      });
      return { code, stdout, stderr };
    };

    const excused = cliCases.filter((f) => (f.pending ?? []).includes("asciichem-ts"));

    for (const fixture of cliCases) {
      it.runIf(!excused.includes(fixture))(fixture.id, async () => {
        const { code, stdout, stderr } = await dispatch(fixture);
        expect(code, `${fixture.id}: exit code (stderr: ${JSON.stringify(stderr)})`).toBe(fixture.exit);
        if (fixture.stdout !== undefined) {
          expect(stdout, fixture.id).toBe(substitute(fixture.stdout));
        }
        for (const included of fixture.stdoutIncludes ?? []) {
          expect(stdout, fixture.id).toContain(substitute(included));
        }
        for (const included of fixture.stderrIncludes ?? []) {
          expect(stderr, fixture.id).toContain(substitute(included));
        }
        if (fixture.stdoutJson !== undefined) {
          // Semantic equality: parsed JSON, so key order cannot fail.
          expect(JSON.parse(stdout), fixture.id).toEqual(fixture.stdoutJson);
        }
      });
    }

    it("reports the pre-excused cases (none for this implementation)", () => {
      expect(cliCases.length, "the corpus carries CLI cases").toBeGreaterThan(0);
      expect(excused.map((f) => f.id)).toEqual([]);
    });
  });

  // CML round-trip family: parse, emit the CML wire through the
  // leptris engine, re-parse, and demand the canonical text back (the
  // three-way contract). `parses: false` cases reject.
  describe("CML round-trip", () => {
    beforeAll(async () => {
      await initCml();
    });

    for (const fixture of cmlCases) {
      it(fixture.id, () => {
        if (fixture.parses === false) {
          expect(() => parseText(fixture.input as string), fixture.id).toThrow(ParseError);
          return;
        }
        expect(fixture.parses, `${fixture.id} must parse`).toBe(true);
        const input = fixture.input as string;
        const cml = parseText(input).toCml();
        expect(parseCmlToFormula(cml).toText(), fixture.id).toBe(input);
      });
    }
  });
});
