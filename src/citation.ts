// Citation track (TODO.v2 08; TODO.impl 44) — the TypeScript mirror
// of AsciiChem::Citation: one dataset-type Relaton bibitem per
// (substance, source) — two databases agreeing on a substance are
// still two different documents.
//
// Source-specific fields (link shape, publisher string, docidentifier
// scheme) live in PROFILES; adding a source is one entry (OCP).
// Unknown sources fall back to the default profile, whose fields
// derive from the substance's own provenance.
//
// The bibitem XML is BUILT and SERIALIZED through the leptris engine
// (the mandated serialization layer): the payload is assembled into
// the engine's document via its programmatic construction API and
// emitted with the engine's serializer — no hand-rolled XML strings;
// escaping, well-formedness, and the emitted bytes all come from
// libleptris. The corpus's citation goldens are byte-captures of the
// Ruby emission for the same substances; the engine's compact output
// is laid out with the relaton indentation (2 spaces) — a pure
// whitespace transform of engine-produced bytes, pending the binding
// growing the engine's serialize options.
import { AsciiChemError } from "./errors.js";
import * as leptrisNamespace from "leptris";
import { provenanceNoteText, type Substance } from "./resolver/substance.js";

export class CitationError extends AsciiChemError {}

type LinkFor = (substance: Substance) => string | null;
type IdentifierFor = (substance: Substance) => string | null;

export interface CitationProfile {
  readonly publisher: string | null;
  readonly linkFor: LinkFor;
  readonly identifierFor: IdentifierFor;
}

function identifierValue(substance: Substance, convention: string): string | null {
  return substance.identifierValue(convention) ?? null;
}

// The known sources. Keys are the resolver's source names.
export const CITATION_PROFILES: Record<string, CitationProfile> = {
  pubchem: {
    publisher: "PubChem, U.S. National Library of Medicine",
    linkFor: (substance) => {
      const cid = identifierValue(substance, "pubchem-cid");
      return cid === null ? null : `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
    },
    identifierFor: (substance) => {
      const cid = identifierValue(substance, "pubchem-cid");
      return cid === null ? null : `PubChem CID ${cid}`;
    },
  },
  common_chemistry: {
    publisher: "CAS Common Chemistry",
    linkFor: (substance) => {
      const cas = identifierValue(substance, "cas");
      return cas === null ? null : `https://commonchemistry.cas.org/detail?cas_rn=${cas}`;
    },
    identifierFor: (substance) => {
      const cas = identifierValue(substance, "cas");
      return cas === null ? null : `CAS RN ${cas}`;
    },
  },
};

// The fallback profile for sources without a dedicated entry: no
// publisher override, no link, and the document identifier is the
// substance's first identifier.
const DEFAULT_PROFILE: CitationProfile = {
  publisher: null,
  linkFor: () => null,
  identifierFor: (substance) => {
    const first = substance.identifiers[0];
    return first === undefined ? null : `${first.convention}: ${first.value}`;
  },
};

function profileFor(source: string): CitationProfile {
  return CITATION_PROFILES[source] ?? DEFAULT_PROFILE;
}

// The relaton-models schema version relaton-bib 2.1.9 renders on every
// bibitem (`Relaton.schema_versions["relaton-models"]`); the corpus
// goldens pin it, so a relaton ride that bumps it re-records them
// deliberately.
const SCHEMA_VERSION = "v1.5.6";

// The dataset bibitem payload: the version-independent fields the
// citation track assembles, translated to the wire shape by the
// serializer.
export interface BibitemPayload {
  // The bibitem's Relaton type — always `dataset` for substances.
  readonly bibitemType: string;
  // Main title: `{title base} - {publisher} substance record`.
  readonly title: string;
  // The document identifier scheme — the citing source's name.
  readonly docidentifierType: string;
  // The document identifier content.
  readonly docidentifier: string;
  // The publisher (the source's organization).
  readonly publisher: string;
  // The accessed date, `YYYY-MM-DD`.
  readonly accessedOn: string;
  // The source record link, when the profile knows the shape.
  readonly link: string | null;
  // Every identifier as `convention=value` — cross-checking keys.
  readonly keywords: string[];
  // The provenance record as a bibliographic note; null when it would
  // say nothing beyond the source name itself.
  readonly note: string | null;
}

function titleBase(substance: Substance): string {
  return (
    substance.preferredName ??
    substance.identifierValue("cas") ??
    substance.identifierValue("inchikey") ??
    "Substance"
  );
}

function accessedOn(substance: Substance): string {
  const retrievedAt = substance.provenance()?.retrievedAt;
  if (retrievedAt !== null && retrievedAt !== undefined) return retrievedAt.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

// Builds a dataset-type bibitem payload for the substance as cited
// from its recorded source. Throws CitationError when the substance
// carries no provenance (hand-built, not resolved).
export function buildBibitem(substance: Substance): BibitemPayload {
  const provenance = substance.provenance();
  if (provenance === null || provenance.source === undefined || provenance.source === "") {
    throw new CitationError("substance has no provenance - resolve it first (AsciiChem::Resolver)");
  }

  const profile = profileFor(provenance.source);
  const publisher = profile.publisher ?? provenance.source;
  const docid = profile.identifierFor(substance) ?? `${provenance.source} substance`;

  return {
    bibitemType: "dataset",
    title: `${titleBase(substance)} - ${publisher} substance record`,
    docidentifierType: provenance.source,
    docidentifier: docid,
    publisher,
    accessedOn: accessedOn(substance),
    link: profile.linkFor(substance),
    keywords: substance.identifiers.map((identifier) => `${identifier.convention}=${identifier.value}`),
    note: provenanceNoteText(provenance),
  };
}

// The leptris engine's init is one-shot and idempotent; every Sync
// call below requires one successful `await engine()` first.
let engineReady: Promise<void> | null = null;

async function engine(): Promise<void> {
  engineReady ??= leptrisNamespace.init().then(() => undefined);
  await engineReady;
}

// Serializes the payload through the leptris engine: the document is
// built with the engine's construction API and emitted with its
// serializer — the byte shape the corpus goldens pin.
export async function bibitemToXml(payload: BibitemPayload): Promise<string> {
  await engine();
  let documentId!: number;
  try {
    documentId = loadShellDocument();
    const root = leptrisNamespace.createElementSync(documentId, "bibitem");
    const id = derivedId(payload.docidentifier);
    if (id !== null) leptrisNamespace.setAttributeSync(root, "id", id);
    leptrisNamespace.setAttributeSync(root, "type", payload.bibitemType);
    leptrisNamespace.setAttributeSync(root, "schema-version", SCHEMA_VERSION);

    const title = leptrisNamespace.createElementSync(documentId, "title");
    leptrisNamespace.setAttributeSync(title, "type", "main");
    leptrisNamespace.appendChildSync(title, leptrisNamespace.createTextSync(documentId, payload.title));
    leptrisNamespace.appendChildSync(root, title);

    if (payload.link !== null) {
      const uri = leptrisNamespace.createElementSync(documentId, "uri");
      leptrisNamespace.setAttributeSync(uri, "type", "src");
      leptrisNamespace.appendChildSync(uri, leptrisNamespace.createTextSync(documentId, payload.link));
      leptrisNamespace.appendChildSync(root, uri);
    }

    const docidentifier = leptrisNamespace.createElementSync(documentId, "docidentifier");
    leptrisNamespace.setAttributeSync(docidentifier, "type", payload.docidentifierType);
    leptrisNamespace.appendChildSync(docidentifier, leptrisNamespace.createTextSync(documentId, payload.docidentifier));
    leptrisNamespace.appendChildSync(root, docidentifier);

    const date = leptrisNamespace.createElementSync(documentId, "date");
    leptrisNamespace.setAttributeSync(date, "type", "accessed");
    const on = leptrisNamespace.createElementSync(documentId, "on");
    leptrisNamespace.appendChildSync(on, leptrisNamespace.createTextSync(documentId, payload.accessedOn));
    leptrisNamespace.appendChildSync(date, on);
    leptrisNamespace.appendChildSync(root, date);

    const contributor = leptrisNamespace.createElementSync(documentId, "contributor");
    const role = leptrisNamespace.createElementSync(documentId, "role");
    leptrisNamespace.setAttributeSync(role, "type", "publisher");
    leptrisNamespace.appendChildSync(contributor, role);
    const organization = leptrisNamespace.createElementSync(documentId, "organization");
    const name = leptrisNamespace.createElementSync(documentId, "name");
    leptrisNamespace.appendChildSync(name, leptrisNamespace.createTextSync(documentId, payload.publisher));
    leptrisNamespace.appendChildSync(organization, name);
    leptrisNamespace.appendChildSync(contributor, organization);
    leptrisNamespace.appendChildSync(root, contributor);

    if (payload.note !== null) {
      const noteElement = leptrisNamespace.createElementSync(documentId, "note");
      leptrisNamespace.setAttributeSync(noteElement, "type", "provenance");
      leptrisNamespace.appendChildSync(noteElement, leptrisNamespace.createTextSync(documentId, payload.note));
      leptrisNamespace.appendChildSync(root, noteElement);
    }

    for (const keyword of payload.keywords) {
      const keywordElement = leptrisNamespace.createElementSync(documentId, "keyword");
      const vocab = leptrisNamespace.createElementSync(documentId, "vocab");
      leptrisNamespace.appendChildSync(vocab, leptrisNamespace.createTextSync(documentId, keyword));
      leptrisNamespace.appendChildSync(keywordElement, vocab);
      leptrisNamespace.appendChildSync(root, keywordElement);
    }

    leptrisNamespace.setRootSync(documentId, root);
    return indentRelaton(await leptrisNamespace.xml(documentId));
  } catch (error) {
    if (error instanceof leptrisNamespace.XmlError) throw new CitationError(`leptris engine error: ${(error as Error).message}`);
    throw error;
  } finally {
    leptrisNamespace.closeSync(documentId);
  }
}

// Convenience: the bibitem XML for a substance (what a document
// pipeline embeds).
export function citationXml(substance: Substance): Promise<string> {
  return bibitemToXml(buildBibitem(substance));
}

// The bibitem `id`: relaton derives it from the document identifier by
// stripping every non-word character (ASCII letters, digits,
// underscore). An identifier that reduces to nothing carries no id.
function derivedId(docidentifier: string): string | null {
  const id = [...docidentifier]
    .filter((character) => /[A-Za-z0-9_]/.test(character))
    .join("");
  return id === "" ? null : id;
}

// A one-element document shell the builder attaches the root to (the
// engine's write face creates elements against a document id).
function loadShellDocument(): number {
  return leptrisNamespace.loadSync("<shell/>");
}

// The relaton indentation over the engine's serialized bytes: 2-space
// nesting, container elements one child per line, leaf elements (and
// their text) inline. Pure whitespace layout of engine-produced,
// well-formed output — the bytes themselves (escaping, ordering,
// self-closing empties) all come from the engine.
function indentRelaton(xml: string): string {
  const tokens = xml.match(/<[^>]*>|[^<]+/g) ?? [];
  // Pass one: match open tags to close tags; a container is an open
  // tag holding at least one element child.
  const openForClose = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (/^<[^/!][^>]*[^/]>$/.test(token)) {
      stack.push(index);
    } else if (/^<\//.test(token)) {
      const open = stack.pop();
      if (open !== undefined) openForClose.set(open, index);
    }
  });
  const containers = new Set<number>();
  for (const [open, close] of openForClose) {
    for (let i = open + 1; i < close; i++) {
      if (tokens[i].startsWith("<")) {
        containers.add(open);
        break;
      }
    }
  }

  // Pass two: emit with indentation, consuming leaf spans inline.
  const lines: string[] = [];
  let depth = 0;
  const pad = () => "  ".repeat(depth);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^<[^/!]/.test(token) && !/\/>$/.test(token)) {
      const close = openForClose.get(index);
      if (containers.has(index) || close === undefined) {
        lines.push(pad() + token);
        depth += 1;
        index += 1;
      } else {
        // Leaf: open + (text) + close on one line.
        let inline = token;
        for (let i = index + 1; i < close; i++) inline += tokens[i];
        inline += tokens[close];
        lines.push(pad() + inline);
        index = close + 1;
      }
    } else if (/^<\//.test(token)) {
      depth = Math.max(0, depth - 1);
      lines.push(pad() + token);
      index += 1;
    } else if (/\/>$/.test(token)) {
      lines.push(pad() + token);
      index += 1;
    } else {
      index += 1; // root-level text: the engine serializer emits none
    }
  }
  return lines.join("\n");
}
