// Molfile (CTfile V2000) parser + writer — the TypeScript mirror of
// AsciiChem::Molfile. Coordinates are preserved on the atoms (x2/y2,
// z2); charges via M  CHG, isotopes via M  ISO; bond type 4 is
// aromatic and marks its atoms; stereo codes 1/6 become wedge/hash.
import { Atom, Bond, BondKind, Formula, Molecule, Node } from "./model.js";
import { ParseError } from "./errors.js";
import { buildGraph, linearize, Edge } from "./structure.js";
import { layoutMolecule } from "./layout.js";

export function parseMolfile(text: string): Molecule {
  const lines = text.split(/\r?\n/);
  if (lines.length < 5) throw new ParseError("molfile too short");

  const atomField = field(lines, 3, 0, 3);
  const bondField = field(lines, 3, 3, 3);
  if (!/^\d+$/.test(atomField) || !/^\d+$/.test(bondField)) {
    throw new ParseError(`malformed counts line: ${JSON.stringify(lines[3])}`);
  }
  const atomCount = Number(atomField);
  const bondCount = Number(bondField);

  const atoms: Atom[] = [];
  for (let i = 1; i <= atomCount; i++) {
    const line = lines[3 + i];
    if (line === undefined) {
      throw new ParseError(`truncated atom block (expected ${atomCount} atoms)`);
    }
    const x = Number(line.slice(0, 10));
    const y = Number(line.slice(10, 20));
    const z = Number(line.slice(20, 30));
    const element = line.slice(31, 34).trim();
    if (element === "") throw new ParseError(`atom ${i} has no element symbol`);
    atoms.push(new Atom(element, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, x, y, z));
  }

  const bonds: { from: number; to: number; kind: BondKind }[] = [];
  for (let i = 1; i <= bondCount; i++) {
    const line = lines[3 + atomCount + i];
    if (line === undefined) {
      throw new ParseError(`truncated bond block (expected ${bondCount} bonds)`);
    }
    const from = Number(line.slice(0, 3)) - 1;
    const to = Number(line.slice(3, 6)) - 1;
    const type = Number(line.slice(6, 9));
    const stereo = Number(line.slice(9, 12));
    if (from < 0 || to < 0 || from >= atoms.length || to >= atoms.length) {
      throw new ParseError(`bond ${i} has out-of-range atom indexes`);
    }
    bonds.push({ from, to, kind: bondKind(type, stereo) });
  }

  applyProperties(lines, atoms);

  // V2000 carries aromaticity on bonds; the model carries it on atoms
  // and bonds, so atoms touching an aromatic bond are marked.
  for (const bond of bonds) {
    if (bond.kind !== "aromatic") continue;
    setAromatic(atoms, bond.from);
    setAromatic(atoms, bond.to);
  }

  const adjacency: Map<number, BondKind>[] = atoms.map(() => new Map());
  const edges: Edge[] = [];
  for (const bond of bonds) {
    adjacency[bond.from].set(bond.to, bond.kind);
    adjacency[bond.to].set(bond.from, bond.kind);
    edges.push({
      from: Math.min(bond.from, bond.to),
      to: Math.max(bond.from, bond.to),
      kind: bond.kind,
    });
  }
  return new Molecule(linearize(atoms, edges));
}

function setAromatic(atoms: Atom[], index: number): void {
  atoms[index] = atoms[index].patch({ aromatic: true });
}

function field(lines: string[], lineIndex: number, start: number, length: number): string {
  return (lines[lineIndex] ?? "").slice(start, start + length).trim();
}

function bondKind(type: number, stereo: number): BondKind {
  if (stereo === 1) return "wedge";
  if (stereo === 6) return "hash";
  const kinds: Record<number, BondKind> = { 1: "single", 2: "double", 3: "triple", 4: "aromatic" };
  const kind = kinds[type];
  if (!kind) throw new ParseError(`unsupported molfile bond type ${type}`);
  return kind;
}

function applyProperties(lines: string[], atoms: Atom[]): void {
  for (const line of lines) {
    if (line.startsWith("M  CHG") || line.startsWith("M  ISO")) {
      const isCharge = line.startsWith("M  CHG");
      const parts = line.slice(6).trim().split(/\s+/);
      for (let i = 1; i + 1 < parts.length; i += 2) {
        const index = Number(parts[i]) - 1;
        const value = Number(parts[i + 1]);
        if (isCharge) {
          const sign = value < 0 ? "-" : "+";
          atoms[index] = atoms[index].patch({
            charge: Math.abs(value) === 1 ? sign : `${Math.abs(value)}${sign}`,
          });
        } else {
          atoms[index] = atoms[index].patch({ isotope: String(value) });
        }
      }
    }
  }
}

// -- writer ---------------------------------------------------------

const BOND_TYPES: Partial<Record<BondKind, number>> = {
  single: 1,
  double: 2,
  triple: 3,
  aromatic: 4,
  wedge: 1,
  hash: 1,
};
const BOND_STEREO: Partial<Record<BondKind, number>> = { wedge: 1, hash: 6 };

export function writeMolfile(molecule: Molecule, name = ""): string {
  const { atoms, edges } = buildGraph(molecule);
  if (edges.length === 0 && atoms.length > 1) {
    throw new ParseError("molecule has no bonds — a formula is not a structure");
  }

  const { positions } = layoutMolecule(molecule);

  const lines: (string | null)[] = [];
  lines.push(name);
  lines.push("  AsciiChem");
  lines.push("");
  lines.push(
    `${pad3(atoms.length)}${pad3(edges.length)}  0  0  0  0  0  0  0  0999 V2000`,
  );

  atoms.forEach((atom, index) => {
    const x = atom.x2 ?? positions[index]?.x ?? 0;
    const y = atom.y2 ?? positions[index]?.y ?? 0;
    const z = atom.z2 ?? 0;
    lines.push(
      `${fixed(x)}${fixed(y)}${fixed(z)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  });

  for (const edge of edges) {
    const type = BOND_TYPES[edge.kind];
    if (type === undefined) throw new ParseError(`${edge.kind} bonds have no molfile V2000 type`);
    const stereo = BOND_STEREO[edge.kind] ?? 0;
    lines.push(
      `${pad3(edge.from + 1)}${pad3(edge.to + 1)}${pad3(type)}${pad3(stereo)}  0  0  0  0  0  0  0`,
    );
  }

  lines.push(propertyLine("M  CHG", chargePairs(atoms)));
  lines.push(propertyLine("M  ISO", isotopePairs(atoms)));
  lines.push("M  END");
  return (
    lines
      .filter((l): l is string => l !== null)
      .join("\n") + "\n"
  );
}

function fixed(n: number): string {
  return n.toFixed(4).padStart(10);
}

function pad3(n: number): string {
  return String(n).padStart(3);
}

function chargePairs(atoms: Atom[]): [number, number][] {
  const pairs: [number, number][] = [];
  atoms.forEach((atom, i) => {
    if (atom.charge === undefined) return;
    const count = Number(/^\d+/.exec(atom.charge)?.[0] ?? 1);
    pairs.push([i + 1, atom.charge.endsWith("-") ? -count : count]);
  });
  return pairs;
}

function isotopePairs(atoms: Atom[]): [number, number][] {
  const pairs: [number, number][] = [];
  atoms.forEach((atom, i) => {
    if (atom.isotope !== undefined) pairs.push([i + 1, Number(atom.isotope)]);
  });
  return pairs;
}

function propertyLine(prefix: string, pairs: [number, number][]): string | null {
  if (pairs.length === 0) return null;
  let line = `${prefix}${pad3(pairs.length)}`;
  for (const [idx, value] of pairs) line += `${pad4(idx)}${pad4(value)}`;
  return line;
}

function pad4(n: number): string {
  return String(n).padStart(4);
}
