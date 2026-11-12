// Loads the asciichem-model v1 JSON Schemas (YAML) and compiles
// validators for the wire forms. Relative "$ref": "x.yaml" links are
// rewritten to the target schema's pinned "$id" before registration.
import Ajv from "ajv";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export function modelSchemaDir(): string {
  return process.env.ASCIICHEM_MODEL ?? join(process.cwd(), "..", "asciichem-model");
}

type JsonSchema = Record<string, unknown> & { $id?: string };

function loadSchemas(dir: string): JsonSchema[] {
  return readdirSync(join(dir, "schemas", "v1"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(join(dir, "schemas", "v1", f), "utf8")) as JsonSchema);
}

function rewriteRefs(node: unknown, idByFile: Map<string, string>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => rewriteRefs(child, idByFile));
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const [file, pointer] = obj.$ref.split("#");
      const id = idByFile.get(file.replace(/\.yaml$/, ""));
      if (id) obj.$ref = pointer ? `${id}#/${pointer}` : id;
    }
    for (const value of Object.values(obj)) rewriteRefs(value, idByFile);
  }
}

function loadSchemasWithRefs(): JsonSchema[] {
  const schemas = loadSchemas(modelSchemaDir());
  const idByFile = new Map<string, string>();
  for (const schema of schemas) {
    const id = schema.$id;
    if (id) {
      const file = id.split("/").pop();
      if (file) idByFile.set(file, id);
    }
  }
  for (const schema of schemas) rewriteRefs(schema, idByFile);
  return schemas;
}

function compileRoot(schemas: JsonSchema[], suffix: string): (wire: unknown) => true | string {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of schemas) ajv.addSchema(schema);
  const validate = ajv.compile(schemas.find((s) => (s.$id ?? "").endsWith(suffix)) as object);
  return (wire: unknown) => {
    const ok = validate(wire);
    if (ok) return true;
    return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
  };
}

export function wireValidator(): (wire: unknown) => true | string {
  return compileRoot(loadSchemasWithRefs(), "/formula");
}

// The resolver family's substance-record validator: the replayed
// substance wire is checked against the asciichem-model v1
// substance-record schema before the semantic comparison.
export function substanceRecordValidator(): (wire: unknown) => true | string {
  return compileRoot(loadSchemasWithRefs(), "/substance-record");
}
