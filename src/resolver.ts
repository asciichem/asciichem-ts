// Resolution turns identifiers into substance records (TODO.v2 07
// layer 2; TODO.impl 38). Multi-source by design: every answering
// source produces its own record with provenance, because the citation
// track (TODO.v2 08) emits one bibitem per (substance, source) the
// user chooses to cite.
//
// Sources are adapters (`./resolver/adapter.js`) registered in a
// `ResolverRegistry`. The Ruby module-level registry maps to an
// explicit registry value: `shippedResolverRegistry()` gives the three
// built-in sources in registration order (pubchem, opsin,
// common_chemistry — Common Chemistry is CC BY-NC 4.0 and default-on
// per the maintainer decision of 2026-11-11; callers that need NC-free
// resolution limit sources explicitly), `register()` adds opt-in
// sources, and the `sources` argument narrows a call to a named
// subset.
//
// Failure posture: a source-level failure (HTTP error, rejected
// request, malformed payload) skips that source — one dead or
// key-gated endpoint must not poison the others; callers see what
// answered. `ConflictError` is the exception: cross-check mode
// (`resolveChecked`, the Ruby `resolve!`) throws when more than one
// answering source provides an InChIKey and they disagree — the
// message lists the disagreement, never hidden.
import { AsciiChemError } from "./errors.js";
import type { Adapter, ResolveOptions } from "./resolver/adapter.js";
import { PubChemAdapter } from "./resolver/pubchem.js";
import { OpsinAdapter } from "./resolver/opsin.js";
import { CommonChemistryAdapter } from "./resolver/common-chemistry.js";
import type { Substance } from "./resolver/substance.js";

export { ResolverError } from "./resolver/adapter.js";

export {
  Adapter,
  NetFetch,
  cgiEscape,
  parseStructure,
  type Fetch,
  type ResolveOptions,
} from "./resolver/adapter.js";
export { Cache, DEFAULT_TTL_SECONDS, type CacheDirOptions } from "./resolver/cache.js";
export { Substance, provenanceNoteText, type Provenance, type ResolverIdentifier, type ResolverProperty } from "./resolver/substance.js";
export { PubChemAdapter, pubchemUrl } from "./resolver/pubchem.js";
export { OpsinAdapter, opsinUrl } from "./resolver/opsin.js";
export {
  CommonChemistryAdapter,
  commonChemistryUrl,
  commonChemistryHeaders,
  defaultApiKey,
} from "./resolver/common-chemistry.js";

// Raised when sources disagree on substance identity (cross-check
// mode). The message lists the disagreement — never hidden.
export class ResolverConflictError extends AsciiChemError {}

// Builds a source adapter. The factories (not instances) populate the
// registry because construction can consult the environment — the
// Common Chemistry key chain reads the env var and the token file at
// build time, exactly as the Ruby registry's `adapter_class.new` does.
export type AdapterFactory = () => Adapter;

// The source registry: registration order, `sources` limiting,
// extension registration.
export class ResolverRegistry {
  private readonly adapters: Map<string, AdapterFactory>;

  constructor(adapters: Map<string, AdapterFactory> = shippedAdapterFactories()) {
    this.adapters = new Map(adapters);
  }

  // The three built-in sources in registration order.
  static shipped(): ResolverRegistry {
    return new ResolverRegistry();
  }

  // Registers an opt-in source (OCP — adding a source is one factory).
  register(name: string, factory: AdapterFactory): this {
    this.adapters.set(name, factory);
    return this;
  }

  names(): string[] {
    return [...this.adapters.keys()];
  }

  private build(name: string): Adapter {
    const factory = this.adapters.get(name);
    if (factory === undefined) {
      throw new AsciiChemError(
        `unknown resolver source ${JSON.stringify(name)} (registered: ${this.names().sort().join(", ")})`,
      );
    }
    return factory();
  }

  // Resolves against every registered source (or the selected subset),
  // returning one Substance per source that answers (null entries
  // dropped). Sources answer in registration order. A source-level
  // failure skips that source — one dead or key-gated endpoint must
  // not poison the others.
  async resolveAll(
    { value, convention }: { value: string; convention: string },
    options: ResolveOptions & { sources?: readonly string[] } = {},
  ): Promise<Substance[]> {
    const selected = options.sources ?? this.names();
    const answered: Substance[] = [];
    for (const source of selected) {
      const adapter = this.build(source);
      if (!adapter.supports(convention)) continue;
      try {
        const substance = await adapter.resolve({ value, convention }, withoutSources(options));
        if (substance !== null) answered.push(substance);
      } catch (error) {
        if (!(error instanceof AsciiChemError)) throw error;
        // source-level failure: isolated, the fan-out continues.
      }
    }
    return answered;
  }

  // First answering source wins.
  async resolve(
    args: { value: string; convention: string },
    options: ResolveOptions & { sources?: readonly string[] } = {},
  ): Promise<Substance | null> {
    return (await this.resolveAll(args, options))[0] ?? null;
  }

  // Cross-check mode: all sources must agree on the primary key
  // (InChIKey) when more than one source provides one.
  async resolveChecked(
    args: { value: string; convention: string },
    options: ResolveOptions & { sources?: readonly string[] } = {},
  ): Promise<Substance | null> {
    const substances = await this.resolveAll(args, options);
    const keys = [...new Set(substances.map((s) => s.identifierValue("inchikey")).filter((k) => k !== undefined))];
    if (keys.length > 1) {
      throw new ResolverConflictError(
        `sources disagree on substance identity (InChIKeys: ${keys.join(" vs ")})`,
      );
    }
    return substances[0] ?? null;
  }
}

function withoutSources(options: ResolveOptions & { sources?: readonly string[] }): ResolveOptions {
  const { sources: _sources, ...rest } = options;
  return rest;
}

// The shipped factories. The default clock rides per-call (live
// resolution stamps the real instant; replay pins its own).
function shippedAdapterFactories(): Map<string, AdapterFactory> {
  return new Map<string, AdapterFactory>([
    ["pubchem", () => new PubChemAdapter()],
    ["opsin", () => new OpsinAdapter()],
    ["common_chemistry", () => new CommonChemistryAdapter()],
  ]);
}

// The default registry (the Ruby `Resolver` module-level shape).
export const defaultResolverRegistry = new ResolverRegistry();

// Convenience one-shot over the default registry: first answering
// source wins.
export function resolveSubstance(
  args: { value: string; convention: string },
  options: ResolveOptions & { sources?: readonly string[] } = {},
): Promise<Substance | null> {
  return defaultResolverRegistry.resolve(args, options);
}
