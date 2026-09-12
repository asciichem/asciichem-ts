# asciichem-ts

TypeScript implementation of [AsciiChem](https://asciichem.org) — an
ASCII syntax for chemistry that parses into a **semantic model**
(atoms, bonds, isotopes, charges, reactions, electron configurations),
not typography. The defining fix over AsciiMath: `^14C` binds the
isotope to the atom (`Atom(element: "C", isotope: "14")`), never to a
phantom `{}` carrier.

This is the npm package **`asciichem`** (strategy A of
[ADR-0001](https://github.com/asciichem/asciichem-ts/blob/main/docs/adr/0001-language-bindings.adoc)):
a native per-language implementation conforming to the shared
contracts — `asciichem-model` (canonical JSON wire form) and
`asciichem-tests` (shared conformance corpus). The Ruby gem remains
the reference implementation; both must pass the same corpus.

## Install

```sh
npm install asciichem
```

## Usage

```ts
import { parse, parseSmiles, parseMolfile } from "asciichem";

const formula = parse("2H_2 + O_2 ->[heat] 2H_2O");

formula.toText();        // canonical AsciiChem text (round-trip contract)
formula.toSvg();         // typographic SVG (true sub/superscripts)
formula.toModelJSON();   // asciichem-model v1 wire JSON

// Structures authored with bonds render as 2D skeletal diagrams:
parse("C1-C-C-C-C-C1").toStructuralSvg(); // cyclohexane hexagon

// Ingest external structures (TODO.v2 09) — same model, same renderers:
const aspirin = parseSmiles("CC(=O)OC1=CC=CC=C1C(=O)O");
aspirin.toStructuralSvg();
aspirin.toSmiles();      // deterministic writer; round-trips exactly
parseMolfile(molfileV2000Text);           // coordinates preserved
```

Rebuild the model from wire JSON with `fromModelJSON` (the lossless
core set; beyond-core node types are emission-only until their corpus
round-trip levels land).

## Conformance claim

Verified in CI against the [asciichem-tests](https://github.com/asciichem/asciichem-tests)
corpus and [asciichem-model](https://github.com/asciichem/asciichem-model)
schemas:

| Level | Claim |
|---|---|
| parse/reject | 100% — every corpus case parses or raises `ParseError` exactly as marked |
| L0 | 100% — emission validates against the v1 JSON Schemas |
| L1 | 100% — `parse(s).toText() === s` for every `roundTrip` case |
| SMILES | 100% — ingestion + deterministic emission, every `structure/smiles/*` fixture (asciichem-tests v0.3.0) |
| molfile | 100% — V2000 ingestion + emission, every `structure/molfile/*` fixture |
| L2+ | MathML, CML round-trip, linter diagnostics: not yet claimed |

The parser is a rule-by-rule peggy port of the reference grammar
(`asciichem-ruby/lib/asciichem/grammar.rb`); alternation order and
lookaheads are preserved so acceptance matches the reference exactly.

## Where molecule structures come from

A molecular formula is **not** a structure: `C_2H_6O` is ethanol or
dimethyl ether. The chemistry world never infers connectivity from a
formula — structural diagrams are drawn from:

1. **Authored bonds and rings, or ingested SMILES/molfile** (what
   this package renders today): AsciiChem syntax carries connectivity
   inline — `CH_3-CH_2-OH`, ring closures `C1-C-C-C-C-C1`, wedges
   `>-`, stereo markers — and `parseSmiles`/`parseMolfile` bring
   database structures into the same model.
2. **Connection tables / line notations from databases** — molfile and
   SDF (PubChem, CAS), SMILES (PubChem canonical/isomeric, CAS),
   InChI (a derived identity encoding, usable for validation and
   citation more than for drawing). AsciiChem molecules can attach
   these via `@smiles("CCO")` / `@inchi(...)` annotations and ingest
   them with `parseSmiles`/`parseMolfile` (TODO.v2 09, landed).
3. **Resolution services** — validate identifiers and fetch structures
   from PubChem / CAS Common Chemistry / OPSIN (TODO.v2 07, 39, 40).

Accordingly, `toStructuralSvg()` renders molecules whose bonds are
authored, and falls back to typographic rendering for formula-only
molecules rather than inventing a structure the author did not state.

## Architecture

```
text ─► grammar (peggy port) ─► transform ─► model ─► formatter (visitor)
                                     │                     ├─ text  (canonicaliser)
                                     │                     ├─ svg   (typographic)
                                     │                     └─ structural-svg (2D layout)
                                     └─ wire ◄──────────────┘
                                       (asciichem-model v1 JSON)
```

- **`grammar/asciichem.pegjs`** — PEG grammar mirroring the reference
  parslet grammar; ordered choice is significant.
- **`src/transform.ts`** — capture tree → model (the only place
  superscripts disambiguate charge vs oxidation state, exactly as the
  reference's AtomBuilder).
- **`src/model.ts`** — node classes + `Visitor<T>`; new output formats
  are new visitors, no model edits (open/closed).
- **`src/layout.ts`** — deterministic 2D layout: pure molecule walker,
  `RingBonds` port, regular-polygon rings, zigzag chains.
- **`src/wire/`** — the v1 JSON interchange; types vendored from
  asciichem-model via `scripts/update-model-types.sh`.

## Development

```sh
npm install
npm test             # unit + corpus conformance (clones corpus+model siblings)
npm run typecheck
npm run build
```

The corpus and model repos are expected as siblings (or point
`ASCIICHEM_CORPUS` / `ASCIICHEM_MODEL` at them).

## License

BSD-2-Clause — same as the rest of the AsciiChem ecosystem.
