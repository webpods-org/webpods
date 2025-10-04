/**
 * Schema validation for stream records
 */

import Ajv from "ajv";
import type { DataContext } from "../data-context.js";
import type { Result, Stream } from "../../types.js";
import { StreamDbRow } from "../../db-types.js";
import { createContext, updateTable } from "@webpods/tinqer";
import { executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const dbContext = createContext<DatabaseSchema>();

const ajv = new Ajv.default({ allErrors: true });

// Cache compiled schemas for performance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schemaCache = new Map<string, any>();

export interface SchemaDefinition {
  schemaType: "json-schema" | "none";
  schema?: object;
  validationMode?: "strict" | "permissive";
  appliesTo?: "content" | "full-record";
}

/**
 * Validate content against stream schema if present
 */
export async function validateAgainstSchema(
  ctx: DataContext,
  stream: Stream | StreamDbRow,
  content: unknown,
): Promise<Result<void>> {
  // Check if stream has schema flag
  const hasSchema =
    "has_schema" in stream
      ? (stream as StreamDbRow).has_schema
      : (stream as Stream).hasSchema;
  const podName =
    "pod_name" in stream
      ? (stream as StreamDbRow).pod_name
      : (stream as Stream).podName;
  const streamPath = stream.path;

  // Fast path - no schema
  if (!hasSchema) {
    return { success: true, data: undefined };
  }

  // Load schema from .config stream's schema record
  const configStreamPath = `${streamPath}/.config`;

  try {
    // Get the latest schema record (record named "schema" in the .config stream)
    // Note: Using raw SQL because of JOIN with specific conditions
    const schemaRecord = await ctx.db.oneOrNone(
      `SELECT r.* FROM record r
       INNER JOIN stream s ON r.stream_id = s.id
       WHERE s.pod_name = $(podName)
         AND s.path = $(configStreamPath)
         AND r.name = 'schema'
       ORDER BY r.index DESC
       LIMIT 1`,
      { podName, configStreamPath },
    );

    if (!schemaRecord) {
      // Schema flag is set but no schema found - allow the write
      // This could happen if schema was deleted or there's an inconsistency
      return { success: true, data: undefined };
    }

    // Parse schema definition
    const schemaDef: SchemaDefinition = JSON.parse(schemaRecord.content);

    // Check if schema is disabled
    if (schemaDef.schemaType === "none") {
      return { success: true, data: undefined };
    }

    // Validate with JSON Schema
    if (schemaDef.schemaType === "json-schema" && schemaDef.schema) {
      const cacheKey = `${podName}/${streamPath}`;
      let validate = schemaCache.get(cacheKey);

      // Compile schema if not cached
      if (!validate) {
        validate = ajv.compile(schemaDef.schema);
        schemaCache.set(cacheKey, validate);
      }

      // Parse content if it's a string
      let dataToValidate;
      try {
        dataToValidate =
          typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid JSON content",
          },
        };
      }

      // Validate
      const valid = validate(dataToValidate);

      if (!valid) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Content validation failed",
            details: {
              configStreamPath,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              errors: validate.errors?.map((err: any) => ({
                field: err.instancePath || err.schemaPath,
                message: err.message,
                params: err.params,
              })),
            },
          },
        };
      }
    }

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "SCHEMA_ERROR",
        message: (error as Error).message || "Schema validation error",
      },
    };
  }
}

/**
 * Update has_schema flag when schema is set or removed
 */
export async function updateSchemaFlag(
  ctx: DataContext,
  streamPath: string,
  podName: string,
  schemaDef: SchemaDefinition,
): Promise<Result<void>> {
  try {
    const hasActiveSchema = schemaDef.schemaType !== "none";

    // Remove .config from the path to get the parent stream path
    // streamPath is like "api/articles/.config" so we need to remove "/.config"
    const parentPath = streamPath.replace("/.config", "");

    const now = Date.now();
    await executeUpdate(
      ctx.db,
      (p: {
        podName: string;
        parentPath: string;
        hasSchema: boolean;
        updatedAt: number;
      }) =>
        updateTable(dbContext, "stream")
          .set(() => ({
            has_schema: p.hasSchema,
            updated_at: p.updatedAt,
          }))
          .where((s) => s.pod_name === p.podName && s.path === p.parentPath),
      { podName, parentPath, hasSchema: hasActiveSchema, updatedAt: now },
    );

    // Clear cache for this stream
    const cacheKey = `${podName}/${parentPath}`;
    schemaCache.delete(cacheKey);

    return { success: true, data: undefined };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "UPDATE_ERROR",
        message: (error as Error).message || "Failed to update schema flag",
      },
    };
  }
}
