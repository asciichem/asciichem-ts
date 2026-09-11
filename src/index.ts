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

// Formatter registration happens as a side effect of these imports.
import "./formatter/text.js";
import "./formatter/svg.js";
import "./wire/to-wire.js";

export { parseText as parse } from "./parser.js";
export { fromModelJSON } from "./wire/from-wire.js";
export { ParseError, AsciiChemError } from "./errors.js";
export * from "./model.js";
export type * as Wire from "./wire/types.js";
export { TextFormatter } from "./formatter/text.js";
export { SvgFormatter } from "./formatter/svg.js";
export { StructuralSvgFormatter } from "./formatter/structural-svg.js";
export { parseText };
