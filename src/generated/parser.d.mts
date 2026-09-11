// Type declarations for the peggy-generated parser. The implementation
// (parser.mjs) is regenerated from grammar/asciichem.pegjs by
// `npm run grammar`; this declaration is hand-maintained because
// peggy's TS codegen is untyped.
export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface FileRange {
  source: unknown;
  start: SourcePosition;
  end: SourcePosition;
}

export interface ParseOptions {
  grammarSource?: unknown;
  startRule?: string;
  [key: string]: unknown;
}

export function parse(input: string, options?: ParseOptions): unknown;

export class SyntaxError extends Error {
  public location: FileRange;
  public expected: unknown[];
  public found: unknown;
  constructor(message: string, expected: unknown[], found: unknown, location: FileRange);
  static buildMessage(expected: unknown[], found: unknown): string;
}
