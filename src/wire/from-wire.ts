// Canonical wire JSON -> semantic model. Ingests the lossless core
// set (the same set the reference WireAdapter ingests); beyond-core
// node types are rejected explicitly rather than silently dropped.
import {
  Atom,
  Bond,
  BondKind,
  BracketKind,
  ElectronConfiguration,
  EmbeddedMath,
  Formula,
  Group,
  Identifier,
  Molecule,
  ArrowKind,
  Reaction,
  ReactionCascade,
  ReactionConditions,
  TermSymbol,
  Text,
  Node,
} from "../model.js";
import { ParseError } from "../errors.js";
import type { WireNode } from "./types.js";

type AnyWire = Record<string, unknown> & { type: string };

const CORE_INGEST_TYPES = new Set([
  "formula",
  "atom",
  "molecule",
  "group",
  "bond",
  "reaction",
  "reaction-cascade",
  "electron-configuration",
  "embedded-math",
  "text",
]);

export function fromModelJSON(json: string | WireNode): Formula {
  const wire: AnyWire = typeof json === "string" ? (JSON.parse(json) as AnyWire) : (json as AnyWire);
  if (wire.type !== "formula") {
    throw new ParseError(`expected a formula node, got ${JSON.stringify(wire.type)}`);
  }
  return fromFormula(wire);
}

function fromNode(wire: AnyWire): Node {
  if (!CORE_INGEST_TYPES.has(wire.type)) {
    throw new ParseError(
      `"${wire.type}" is not in the ingestible core set (emission covers it; round-trip acceptance lands with its corpus level)`,
    );
  }
  switch (wire.type) {
    case "formula":
      return fromFormula(wire);
    case "atom":
      return new Atom(
        wire.element as string,
        optionalString(wire.isotope),
        optionalString(wire.subscript),
        optionalString(wire.superscript),
        optionalString(wire.charge),
        optionalString(wire.oxidationState),
        optionalNumber(wire.lonePairs),
        optionalNumber(wire.radicalElectrons),
        optionalString(wire.ringClosures),
        wire.aromatic === true,
        optionalNumber(wire.hydrogens),
      );
    case "bond":
      return new Bond((wire.kind as BondKind) ?? "single");
    case "group":
      return new Group(
        (wire.nodes as AnyWire[]).map(fromNode),
        optionalString(wire.multiplicity),
        (wire.bracket as BracketKind) ?? "paren",
      );
    case "molecule": {
      const molecule = new Molecule(
        (wire.nodes as AnyWire[]).map(fromNode),
        optionalString(wire.coefficient),
        wire.stereo as Molecule["stereo"],
      );
      for (const identifier of (wire.identifiers as AnyWire[] | undefined) ?? []) {
        molecule.identifiers.push(
          new Identifier(
            identifier.value as string,
            identifier.convention as string,
            optionalString(identifier.dictRef),
          ),
        );
      }
      return molecule;
    }
    case "reaction": {
      const conditions = wire.conditions as AnyWire | undefined;
      return new Reaction(
        (wire.reactants as AnyWire[]).map(fromNode) as Molecule[],
        (wire.products as AnyWire[]).map(fromNode) as Molecule[],
        (wire.arrow as ArrowKind) ?? "forward",
        conditions
          ? new ReactionConditions(
              optionalString(conditions.above),
              optionalString(conditions.below),
            )
          : undefined,
      );
    }
    case "reaction-cascade":
      return new ReactionCascade((wire.steps as AnyWire[]).map(fromNode) as Reaction[]);
    case "electron-configuration":
      return new ElectronConfiguration(
        (wire.orbitals as AnyWire[]).map((o) => [o.orbital as string, o.occupancy as string]),
        wire.termSymbol
          ? new TermSymbol(
              optionalString((wire.termSymbol as AnyWire).multiplicity),
              optionalString((wire.termSymbol as AnyWire).letter),
              optionalString((wire.termSymbol as AnyWire).jValue),
            )
          : undefined,
      );
    case "embedded-math":
      return new EmbeddedMath(wire.source as string);
    case "text":
      return new Text(wire.content as string);
    default:
      throw new ParseError(`unhandled wire type: ${wire.type}`);
  }
}

function fromFormula(wire: AnyWire): Formula {
  return new Formula(((wire.nodes as AnyWire[] | undefined) ?? []).map(fromNode));
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
