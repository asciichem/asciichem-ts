// Periodic table — the single source of truth for element data
// (the TypeScript mirror of AsciiChem::PeriodicTable). Consumed by the
// linter checks (element validation, isotope sanity, valence) and the
// identifier validators (InChI formula layer, SMILES element tokens).
//
// Adding a field (e.g. atomic mass consumers) is one column on
// Element and populating it across ELEMENTS — no other code changes.

export interface Element {
  readonly symbol: string;
  readonly atomicNumber: number;
  readonly maxValence: number;
}

// Subset covering the elements chemistry most commonly deals with.
// Adding more elements is one line per element; the linter picks them
// up automatically.
const ELEMENTS: Record<string, Element> = {
  // Period 1
  H: { symbol: "H", atomicNumber: 1, maxValence: 1 },
  He: { symbol: "He", atomicNumber: 2, maxValence: 0 },
  // Period 2
  Li: { symbol: "Li", atomicNumber: 3, maxValence: 1 },
  Be: { symbol: "Be", atomicNumber: 4, maxValence: 2 },
  B: { symbol: "B", atomicNumber: 5, maxValence: 3 },
  C: { symbol: "C", atomicNumber: 6, maxValence: 4 },
  N: { symbol: "N", atomicNumber: 7, maxValence: 3 },
  O: { symbol: "O", atomicNumber: 8, maxValence: 2 },
  F: { symbol: "F", atomicNumber: 9, maxValence: 1 },
  Ne: { symbol: "Ne", atomicNumber: 10, maxValence: 0 },
  // Period 3
  Na: { symbol: "Na", atomicNumber: 11, maxValence: 1 },
  Mg: { symbol: "Mg", atomicNumber: 12, maxValence: 2 },
  Al: { symbol: "Al", atomicNumber: 13, maxValence: 3 },
  Si: { symbol: "Si", atomicNumber: 14, maxValence: 4 },
  P: { symbol: "P", atomicNumber: 15, maxValence: 5 },
  S: { symbol: "S", atomicNumber: 16, maxValence: 6 },
  Cl: { symbol: "Cl", atomicNumber: 17, maxValence: 1 },
  Ar: { symbol: "Ar", atomicNumber: 18, maxValence: 0 },
  // Period 4 (common)
  K: { symbol: "K", atomicNumber: 19, maxValence: 1 },
  Ca: { symbol: "Ca", atomicNumber: 20, maxValence: 2 },
  Sc: { symbol: "Sc", atomicNumber: 21, maxValence: 3 },
  Ti: { symbol: "Ti", atomicNumber: 22, maxValence: 4 },
  V: { symbol: "V", atomicNumber: 23, maxValence: 5 },
  Cr: { symbol: "Cr", atomicNumber: 24, maxValence: 6 },
  Mn: { symbol: "Mn", atomicNumber: 25, maxValence: 7 },
  Fe: { symbol: "Fe", atomicNumber: 26, maxValence: 6 },
  Co: { symbol: "Co", atomicNumber: 27, maxValence: 4 },
  Ni: { symbol: "Ni", atomicNumber: 28, maxValence: 4 },
  Cu: { symbol: "Cu", atomicNumber: 29, maxValence: 4 },
  Zn: { symbol: "Zn", atomicNumber: 30, maxValence: 2 },
  Ga: { symbol: "Ga", atomicNumber: 31, maxValence: 3 },
  Ge: { symbol: "Ge", atomicNumber: 32, maxValence: 4 },
  As: { symbol: "As", atomicNumber: 33, maxValence: 3 },
  Se: { symbol: "Se", atomicNumber: 34, maxValence: 2 },
  Br: { symbol: "Br", atomicNumber: 35, maxValence: 1 },
  Kr: { symbol: "Kr", atomicNumber: 36, maxValence: 0 },
  // Period 5 (common)
  Rb: { symbol: "Rb", atomicNumber: 37, maxValence: 1 },
  Sr: { symbol: "Sr", atomicNumber: 38, maxValence: 2 },
  Y: { symbol: "Y", atomicNumber: 39, maxValence: 3 },
  Zr: { symbol: "Zr", atomicNumber: 40, maxValence: 4 },
  Nb: { symbol: "Nb", atomicNumber: 41, maxValence: 5 },
  Mo: { symbol: "Mo", atomicNumber: 42, maxValence: 6 },
  Tc: { symbol: "Tc", atomicNumber: 43, maxValence: 6 },
  Ru: { symbol: "Ru", atomicNumber: 44, maxValence: 6 },
  Rh: { symbol: "Rh", atomicNumber: 45, maxValence: 6 },
  Pd: { symbol: "Pd", atomicNumber: 46, maxValence: 4 },
  Ag: { symbol: "Ag", atomicNumber: 47, maxValence: 4 },
  Cd: { symbol: "Cd", atomicNumber: 48, maxValence: 2 },
  In: { symbol: "In", atomicNumber: 49, maxValence: 3 },
  Sn: { symbol: "Sn", atomicNumber: 50, maxValence: 4 },
  Sb: { symbol: "Sb", atomicNumber: 51, maxValence: 3 },
  Te: { symbol: "Te", atomicNumber: 52, maxValence: 2 },
  I: { symbol: "I", atomicNumber: 53, maxValence: 1 },
  Xe: { symbol: "Xe", atomicNumber: 54, maxValence: 0 },
  // Period 6 (common)
  Cs: { symbol: "Cs", atomicNumber: 55, maxValence: 1 },
  Ba: { symbol: "Ba", atomicNumber: 56, maxValence: 2 },
  W: { symbol: "W", atomicNumber: 74, maxValence: 6 },
  Pt: { symbol: "Pt", atomicNumber: 78, maxValence: 4 },
  Au: { symbol: "Au", atomicNumber: 79, maxValence: 6 },
  Hg: { symbol: "Hg", atomicNumber: 80, maxValence: 2 },
  Tl: { symbol: "Tl", atomicNumber: 81, maxValence: 3 },
  Pb: { symbol: "Pb", atomicNumber: 82, maxValence: 4 },
  Bi: { symbol: "Bi", atomicNumber: 83, maxValence: 3 },
  // Period 7 (common)
  U: { symbol: "U", atomicNumber: 92, maxValence: 6 },
};

// IUPAC 2021 standard atomic weights (isotope-averaged) for the most
// common elements.
export const ATOMIC_MASSES: Record<string, number> = {
  H: 1.008, He: 4.0026,
  Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085,
  P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867,
  V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971,
  Br: 79.904, Kr: 83.798,
  Rb: 85.468, Sr: 87.62, Ag: 107.87, Cd: 112.41,
  Sn: 118.71, I: 126.9, Xe: 131.29,
  Cs: 132.91, Ba: 137.33, Au: 196.97, Hg: 200.59,
  Pb: 207.2, Bi: 208.98, U: 238.03,
};

export function element(symbol: string): Element | undefined {
  return ELEMENTS[symbol];
}

export function known(symbol: string): boolean {
  return symbol in ELEMENTS;
}

export function atomicNumber(symbol: string): number | undefined {
  return element(symbol)?.atomicNumber;
}

export function maxValence(symbol: string): number | undefined {
  return element(symbol)?.maxValence;
}

export function atomicMass(symbol: string): number | undefined {
  return ATOMIC_MASSES[symbol];
}

export function symbols(): string[] {
  return Object.keys(ELEMENTS);
}
