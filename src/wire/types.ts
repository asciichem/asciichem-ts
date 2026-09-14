// Canonical wire types for the asciichem-model v1 JSON form.
// Vendored from asciichem-model schemas/v1/types (local main; next tag pending) —
// regenerate with scripts/update-model-types.sh, never edit by hand.
export interface Atom {
  readonly type: "atom";
  readonly element: string;
  readonly isotope?: string;
  readonly charge?: string;
  readonly subscript?: string;
  readonly oxidationState?: string;
  readonly lonePairs?: number;
  readonly radicalElectrons?: number;
  readonly ringClosures?: string;
  readonly aromatic?: boolean;
  readonly hydrogens?: number;
}

export interface Bond {
  readonly type: "bond";
  readonly kind?: "single" | "double" | "triple" | "quadruple" | "wedge" | "hash" | "dative" | "wavy" | "aromatic";
}

export interface Calculation {
  readonly type: "calculation";
  readonly method?: string;
  readonly basis?: string;
  readonly properties?: {
    title: string;
    value: string;
    units?: string;
    dictRef?: string;
    convention?: string;
  }[];
}

export interface Crystal {
  readonly type: "crystal";
  readonly name?: string;
  readonly a?: number;
  readonly b?: number;
  readonly c?: number;
  readonly alpha?: number;
  readonly beta?: number;
  readonly gamma?: number;
  readonly spacegroup?: string;
  readonly atoms?: Atom[];
}

export interface ElectronConfiguration {
  readonly type: "electron-configuration";
  readonly orbitals: {
    orbital: string;
    occupancy: string;
  }[];
  readonly termSymbol?: {
    multiplicity?: string;
    letter?: string;
    jValue?: string;
  };
}

export interface EmbeddedMath {
  readonly type: "embedded-math";
  readonly source: string;
}

export interface Formula {
  readonly type: "formula";
  readonly nodes: (Molecule | Reaction | ReactionCascade | Group | Atom | Bond | ElectronConfiguration | EmbeddedMath | Text | Name | Identifier | Mechanism | Spectrum | Crystal | ZMatrix | Calculation)[];
}

export interface Group {
  readonly type: "group";
  readonly nodes: (Molecule | Group | Bond | Atom)[];
  readonly multiplicity?: string;
  readonly bracket?: "paren" | "square" | "brace";
}

export interface Identifier {
  readonly type: "identifier";
  readonly value: string;
  readonly convention: "cas" | "inchi" | "inchikey" | "smiles" | "canonical-smiles" | "iupac-name" | "pubchem-cid" | "chebi";
  readonly dictRef?: string;
}

export type Node =
  | Atom
  | Bond
  | Calculation
  | Crystal
  | ElectronConfiguration
  | EmbeddedMath
  | Formula
  | Group
  | Identifier
  | Mechanism
  | Molecule
  | Name
  | Provenance
  | ReactionCascade
  | Reaction
  | Spectrum
  | SubstanceRecord
  | Text
  | ZMatrix;

export interface Mechanism {
  readonly type: "mechanism";
  readonly steps?: {
    label?: string;
    reaction: Reaction;
  }[];
  readonly spectators?: Molecule[];
}

export interface Molecule {
  readonly type: "molecule";
  readonly nodes: (Molecule | Group | Bond | Atom)[];
  readonly coefficient?: string;
  readonly stereo?: "R" | "S" | "E" | "Z" | "alpha" | "beta";
  readonly identifiers?: Identifier[];
}

export interface Name {
  readonly type: "name";
  readonly content: string;
  readonly convention?: string;
  readonly dictRef?: string;
}

export interface Provenance {
  readonly type: "provenance";
  readonly source: string;
  readonly retrievedAt: string;
  readonly sourceVersion?: string;
  readonly attribution?: string;
}

export interface ReactionCascade {
  readonly type: "reaction-cascade";
  readonly steps: Reaction[];
}

export interface Reaction {
  readonly type: "reaction";
  readonly reactants: Molecule[];
  readonly products: Molecule[];
  readonly arrow?: "forward" | "reverse" | "equilibrium" | "resonance";
  readonly conditions?: {
    above?: string;
    below?: string;
  };
}

export interface Spectrum {
  readonly type: "spectrum";
  readonly technique?: string;
  readonly params?: {
  };
  readonly peaks?: {
    position: string;
    intensity?: string;
    multiplicity?: string;
    assignment?: string;
  }[];
}

export interface SubstanceRecord {
  readonly type: "substance-record";
  readonly preferredName?: string;
  readonly synonyms?: string[];
  readonly formula?: string;
  readonly molecularWeight?: number;
  readonly identifiers: {
    identifier: Identifier;
    provenance: Provenance;
  }[];
  readonly properties?: {
    name: string;
    value: string;
    units?: string;
    provenance: Provenance;
  }[];
}

export interface Text {
  readonly type: "text";
  readonly content: string;
}

export interface ZMatrix {
  readonly type: "zmatrix";
  readonly rows?: {
    atom: string;
    ref1?: string;
    distance?: string;
    ref2?: string;
    angle?: string;
    ref3?: string;
    dihedral?: string;
  }[];
}


// Union of every node type in the v1 model.
export type WireNode =
  | Atom
  | Bond
  | Calculation
  | Crystal
  | ElectronConfiguration
  | EmbeddedMath
  | Formula
  | Group
  | Identifier
  | Mechanism
  | Molecule
  | Name
  | Provenance
  | ReactionCascade
  | Reaction
  | Spectrum
  | SubstanceRecord
  | Text
  | ZMatrix;
