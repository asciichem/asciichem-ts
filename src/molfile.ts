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
  const { atoms: modelAtoms, edges: modelEdges } = buildGraph(molecule);
  if (modelEdges.length === 0 && modelAtoms.length > 1) {
    throw new ParseError("molecule has no bonds — a formula is not a structure");
  }

  // Aromatic carriers lose their bracket H in the identity pipe: the
  // V2000 H-count column is oracle-ignored (the release engine never
  // reads it) and the valence derivation does not hand aromatic atoms
  // their H — a pyrrole's [nH] reads one hydrogen short (the Ruby
  // transport loss, asciichem-ruby#181). The explicit H atom is the
  // transport that survives, the same posture as [2H]. Non-aromatic
  // carriers are untouched: their H derive by valence everywhere, and
  // the recorded corpus molfiles pin their bytes.
  const atoms: Atom[] = [...modelAtoms];
  const edges: Edge[] = [...modelEdges];
  const hCarriers: { target: number; carrier: number; nth: number }[] = [];
  const baseAtoms = modelAtoms.length;
  for (const [index, atom] of modelAtoms.entries()) {
    if (!atom.aromatic || !atom.hydrogens) continue;
    for (let nth = 0; nth < atom.hydrogens; nth++) {
      const target = atoms.length;
      hCarriers.push({ target, carrier: index, nth });
      atoms.push(new Atom("H"));
      edges.push({ from: index, to: target, kind: "single" });
    }
  }

  const { positions } = layoutMolecule(molecule);

  const lines: (string | null)[] = [];
  lines.push(name);
  lines.push("  AsciiChem");
  lines.push("");
  lines.push(
    `${pad3(atoms.length)}${pad3(edges.length)}  0  0  0  0  0  0  0  0999 V2000`,
  );

  const coords: { x: number; y: number }[] = atoms.map((atom, index) => {
    // Materialized H atoms sit offset from their carrier (stacked when
    // several) — no layout position exists for them.
    const carrier = hCarriers.find((entry) => entry.target === index);
    let x: number;
    let y: number;
    if (carrier) {
      const from = modelAtoms[carrier.carrier];
      x = (from.x2 ?? positions[carrier.carrier]?.x ?? 0) + 0.75;
      y = (from.y2 ?? positions[carrier.carrier]?.y ?? 0) + 0.75 * carrier.nth;
    } else {
      x = atom.x2 ?? positions[index]?.x ?? 0;
      y = atom.y2 ?? positions[index]?.y ?? 0;
    }
    return { x, y };
  });

  // One wedge per chiral atom, on its first bond. The chiral atom's
  // heavy ligands sit in a trigonal triangle around it (the chemomer
  // synthesis's corpus-fitted shape) and the wedge code pairs with
  // that handedness: TH1 falls (6), TH2 rises (1). The base layout's
  // zigzag can collide ligand positions, and a degenerate drawing
  // reads no parity at all, so the stereocentre's neighbourhood is
  // synthesized deterministically.
  // Directional bonds draw the E/Z layer: a direction rides a single
  // bond adjacent to a double bond, and the substituent's SIDE of that
  // double bond is the drawn information. The layout's arbitrary
  // placement carries no side semantics (the layered layout draws
  // chains collinear), so each directional substituent is placed
  // perpendicular to the double-bond axis, anchored at its bond
  // partner, with the side read against the STRING-ORDERED axis (a→b)
  // — the chemomer lift's invariant, so `C/C=C/C` draws trans and
  // `C/C=C\C` cis regardless of which end the axis runs from.
  edges.forEach((edge) => {
    if (edge.direction === undefined) return;
    const resolved = doubleBondAxis(edges, edge);
    if (!resolved) return;
    const [axis, pIndex, uIndex] = resolved;
    const qIndex = axis.from === pIndex ? axis.to : axis.from;
    const aIndex = Math.min(pIndex, qIndex);
    const bIndex = Math.max(pIndex, qIndex);
    const { x: ax, y: ay } = coords[aIndex];
    const { x: bx, y: by } = coords[bIndex];
    const { x: px, y: py } = coords[pIndex];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-9) return;
    const nx = -dy / length;
    const ny = dx / length;
    const side = (edge.direction === "up" ? 1 : -1) * (uIndex > aIndex ? 1 : -1);
    coords[uIndex] = { x: px + nx * length * side, y: py + ny * length * side };
  });

  const wedges = new Map<number, { from: number; to: number; stereo: number }>();
  atoms.forEach((atom, index) => {
    if (atom.chirality !== "TH1" && atom.chirality !== "TH2") return;
    const ligandBonds = edges
      .map((edge, bondIndex) => ({ edge, bondIndex }))
      .filter(({ edge }) => edge.from === index || edge.to === index);
    const { x: cx, y: cy } = coords[index];
    ligandBonds.slice(0, 3).forEach(({ edge }, slot) => {
      const ligand = edge.from === index ? edge.to : edge.from;
      const angle = ((90 + 120 * slot) * Math.PI) / 180;
      coords[ligand] = { x: cx + 28 * Math.cos(angle), y: cy + 28 * Math.sin(angle) };
    });
    const first = ligandBonds[0];
    const edge = first.edge;
    const other = edge.from === index ? edge.to : edge.from;
    wedges.set(first.bondIndex, {
      from: index,
      to: other,
      stereo: atom.chirality === "TH1" ? 6 : 1,
    });
  });

  atoms.forEach((atom, index) => {
    const { x, y } = coords[index];
    const z = atom.z2 ?? 0;
    lines.push(
      `${fixed(x)}${fixed(y)}${fixed(z)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  });

  edges.forEach((edge, bondIndex) => {
    const type = BOND_TYPES[edge.kind];
    if (type === undefined) throw new ParseError(`${edge.kind} bonds have no molfile V2000 type`);
    const stereo = BOND_STEREO[edge.kind] ?? 0;
    const wedge = wedges.get(bondIndex);
    const from = wedge ? wedge.from : edge.from;
    const to = wedge ? wedge.to : edge.to;
    const bondStereo = wedge ? wedge.stereo : stereo;
    lines.push(
      `${pad3(from + 1)}${pad3(to + 1)}${pad3(type)}${pad3(bondStereo)}  0  0  0  0  0  0  0`,
    );
  });

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

// The double-bond axis a directional bond borders: which end of the
// single bond touches a kind-2 bond's atom, with that endpoint, the
// substituent (the other end), and the double-bond edge.
function doubleBondAxis(edges: Edge[], single: Edge): [Edge, number, number] | undefined {
  for (const [atom, other] of [
    [single.from, single.to],
    [single.to, single.from],
  ]) {
    const axis = edges.find(
      (candidate) =>
        candidate.kind === "double" &&
        ((candidate.from === atom && candidate.to !== other) ||
          (candidate.to === atom && candidate.from !== other)),
    );
    if (axis) {
      const substituent = single.from === atom ? single.to : single.from;
      return [axis, atom, substituent];
    }
  }
  return undefined;
}
