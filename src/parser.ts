// Parse entry point: grammar -> capture tree -> semantic model.
// Callers only ever see AsciiChem's own error types.
import { parse, SyntaxError as PeggySyntaxError } from "./generated/parser.mjs";
import { buildFormula, type FormulaCapture } from "./transform.js";
import { Formula } from "./model.js";
import { ParseError } from "./errors.js";

export function parseText(input: string): Formula {
  try {
    return buildFormula(parse(input) as FormulaCapture);
  } catch (error) {
    if (error instanceof PeggySyntaxError) {
      const start = error.location?.start;
      throw new ParseError(
        `AsciiChem parse error: ${error.message}`,
        start ? { line: start.line, column: start.column, offset: start.offset } : undefined,
      );
    }
    throw error;
  }
}
