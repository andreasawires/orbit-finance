import { z } from "zod";

// Ollama compiles its `format` JSON Schema into a llama.cpp grammar. That
// compiler intentionally supports only a subset of JSON Schema, so semantic
// constraints stay in the authoritative Zod schema and are applied after the
// model responds. The generation schema only constrains JSON shape and enums.
const postGenerationValidationKeywords = new Set([
  "default",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "title",
  "uniqueItems",
]);

function removePostGenerationConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removePostGenerationConstraints);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (postGenerationValidationKeywords.has(key)) return [];
      // Property and definition names are user-defined, so do not confuse a
      // field named "pattern" or "default" with a JSON Schema keyword.
      if ((key === "properties" || key === "$defs" || key === "definitions") && child && typeof child === "object") {
        return [[key, Object.fromEntries(
          Object.entries(child).map(([name, childSchema]) => [name, removePostGenerationConstraints(childSchema)]),
        )]];
      }
      return [[key, removePostGenerationConstraints(child)]];
    }),
  );
}

export function ollamaGenerationSchema<T>(schema: z.ZodType<T>) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  return removePostGenerationConstraints(jsonSchema) as Record<string, unknown>;
}
