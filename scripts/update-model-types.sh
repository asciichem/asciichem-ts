#!/usr/bin/env bash
# Re-vendor the canonical wire types from asciichem-model's generated
# TypeScript. Usage: scripts/update-model-types.sh [model-tag]
# (default: main). The types are concatenated into src/wire/types.ts
# because the per-file generator output assumes a bundler resolution
# that NodeNext does not provide.
set -euo pipefail

tag="${1:-main}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --depth 1 --branch "$tag" https://github.com/asciichem/asciichem-model.git "$work/model"

{
  echo "// Canonical wire types for the asciichem-model v1 JSON form."
  echo "// Vendored from asciichem-model schemas/v1/types (tag $tag) —"
  echo "// regenerate with scripts/update-model-types.sh, never edit by hand."
  for f in "$work"/model/schemas/v1/types/*.ts; do
    grep -v '^//' "$f" | grep -v '^$'
    echo
  done
  cat <<'UNION'

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
UNION
} > src/wire/types.ts

echo "src/wire/types.ts updated from asciichem-model $tag"
