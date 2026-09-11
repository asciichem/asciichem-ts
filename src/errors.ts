// Error taxonomy, mirroring AsciiChem::ParseError. Peggy syntax errors
// are wrapped so callers only ever see AsciiChem errors from parse().
export class AsciiChemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export class ParseError extends AsciiChemError {
  readonly location?: SourceLocation;

  constructor(message: string, location?: SourceLocation) {
    super(message);
    this.location = location;
  }
}
