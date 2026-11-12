// asciichem — TypeScript implementation of the AsciiChem contract.
//
// Public API:
//   import { parse, fromModelJSON } from "asciichem";
//   parse("H_2O").toText();          // canonical text
//   parse("C1CCCCC1").toStructuralSvg(); // 2D structural diagram
//   parse("H_2O").toModelJSON();     // asciichem-model v1 wire form
import { parseText } from "./parser.js";
import { fromModelJSON } from "./wire/from-wire.js";
import { ParseError } from "./errors.js";
import { parseSmiles, writeSmiles } from "./smiles.js";
import { parseMolfile, writeMolfile } from "./molfile.js";
import { registerRenderer } from "./model.js";
import { Formula, Molecule } from "./model.js";

// Formatter registration happens as a side effect of these imports.
import "./formatter/text.js";
import "./formatter/svg.js";
import "./formatter/mathml.js";
import "./wire/to-wire.js";

// Linter check registration happens as a side effect of this import
// (the same pattern as the formatter registrations).
import "./linter/checks.js";

registerRenderer<string>("smiles", (node) => {
  if (node instanceof Formula || node instanceof Molecule) return writeSmiles(node);
  throw new ParseError("only molecules and formulas of molecules have a SMILES form");
});
registerRenderer<string>("molfile", (node) => {
  if (node instanceof Molecule) return writeMolfile(node);
  throw new ParseError("only molecules have a molfile form");
});

export { parseText as parse } from "./parser.js";
export { fromModelJSON } from "./wire/from-wire.js";
export { ParseError, AsciiChemError } from "./errors.js";
export * from "./model.js";
export type * as Wire from "./wire/types.js";
export { TextFormatter } from "./formatter/text.js";
export { SvgFormatter } from "./formatter/svg.js";
export { StructuralSvgFormatter } from "./formatter/structural-svg.js";
export { MathmlFormatter, renderMathml } from "./formatter/mathml.js";
export { parseSmiles, writeSmiles, parseMolfile, writeMolfile };
export * as Perception from "./perception.js";
export { parseText };
export {
  EngineMissingError as InchiEngineMissingError,
  identityFor as inchiIdentityFor,
  setInchiEngine,
  type InchiEngine,
  type InchiIdentity,
} from "./inchi.js";
export {
  runLinter,
  hasLintErrors,
  checkNames,
  Diagnostic,
  type Severity,
  type LintCheck,
  type LintOptions,
} from "./linter.js";
export {
  knownConvention,
  validIdentifier,
  identifierDiagnostic,
  validatorFor,
  type Validator,
} from "./identifiers.js";
export {
  ResolverRegistry,
  ResolverConflictError,
  ResolverError,
  resolveSubstance,
  defaultResolverRegistry,
  NetFetch,
  cgiEscape,
  Cache,
  DEFAULT_TTL_SECONDS,
  Substance,
  provenanceNoteText,
  PubChemAdapter,
  OpsinAdapter,
  CommonChemistryAdapter,
  defaultApiKey,
  type Adapter,
  type Fetch,
  type ResolveOptions,
  type Provenance,
  type ResolverIdentifier,
  type ResolverProperty,
} from "./resolver.js";
export {
  buildBibitem,
  bibitemToXml,
  citationXml,
  CitationError,
  CITATION_PROFILES,
  type BibitemPayload,
  type CitationProfile,
} from "./citation.js";
