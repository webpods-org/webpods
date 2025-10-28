/**
 * Update URL routing links for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:routing");
const schema = createSchema<DatabaseSchema>();

export async function updateLinks(
  ctx: DataContext,
  podName: string,
  links: Record<string, string>,
  userId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Get pod
      const podResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.pod_name)
            .take(1),
        { pod_name: podName },
      );

      const pod = podResults[0] || null;

      if (!pod) {
        return failure(new Error("Pod not found"));
      }

      // Get or create .config stream
      const configStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.pod_name &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .take(1),
        { pod_name: podName },
      );

      let configStream = configStreamResults[0] || null;

      if (!configStream) {
        // Create .config stream
        const now = Date.now();
        const configStreamCreateResults = await executeInsert(
          t,
          schema,
          (q, p) =>
            q
              .insertInto("stream")
              .values({
                pod_name: p.pod_name,
                name: p.name,
                path: p.path,
                parent_id: p.parent_id,
                user_id: p.user_id,
                access_permission: p.access_permission,
                metadata: p.metadata,
                has_schema: p.has_schema,
                created_at: p.created_at,
                updated_at: p.updated_at,
              })
              .returning((s) => s),
          {
            pod_name: podName,
            name: ".config",
            path: ".config",
            parent_id: null,
            user_id: userId,
            access_permission: "private",
            metadata: JSON.stringify({}),
            has_schema: false,
            created_at: now,
            updated_at: now,
          },
        );

        configStream = configStreamCreateResults[0] || null;
        if (!configStream) {
          return failure(new Error("Failed to create .config stream"));
        }
      }

      // Get or create routing stream as child of .config
      const routingStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parent_id && s.name === "routing")
            .take(1),
        { parent_id: configStream.id },
      );

      let routingStream = routingStreamResults[0] || null;

      if (!routingStream) {
        // Create routing stream
        const now = Date.now();
        const routingStreamCreateResults = await executeInsert(
          t,
          schema,
          (q, p) =>
            q
              .insertInto("stream")
              .values({
                pod_name: p.pod_name,
                name: p.name,
                path: p.path,
                parent_id: p.parent_id,
                user_id: p.user_id,
                access_permission: p.access_permission,
                metadata: p.metadata,
                has_schema: p.has_schema,
                created_at: p.created_at,
                updated_at: p.updated_at,
              })
              .returning((s) => s),
          {
            pod_name: podName,
            name: "routing",
            path: ".config/routing",
            parent_id: configStream.id,
            user_id: userId,
            access_permission: "private",
            metadata: JSON.stringify({}),
            has_schema: false,
            created_at: now,
            updated_at: now,
          },
        );

        routingStream = routingStreamCreateResults[0] || null;
        if (!routingStream) {
          return failure(new Error("Failed to create routing stream"));
        }
      }

      // Get previous record for hash chain
      const previousRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id)
            .select((r) => ({ index: r.index, hash: r.hash }))
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: routingStream.id },
      );

      const previousRecord = previousRecordResults[0] || null;

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = Date.now();

      // Calculate hash
      const contentHash = calculateContentHash(links);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const contentString = JSON.stringify(links);
      const size = Buffer.byteLength(contentString, "utf8");

      // Write new links record with all links in one record
      await executeInsert(
        t,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.stream_id,
            index: p.index,
            content: p.content,
            content_type: p.content_type,
            is_binary: p.is_binary,
            size: p.size,
            name: p.name,
            path: p.path,
            content_hash: p.content_hash,
            hash: p.hash,
            previous_hash: p.previous_hash,
            user_id: p.user_id,
            headers: p.headers,
            deleted: p.deleted,
            purged: p.purged,
            created_at: p.created_at,
          }),
        {
          stream_id: routingStream.id,
          index: index,
          content: contentString,
          content_type: "application/json",
          is_binary: false,
          size: size,
          name: "routes",
          path: ".config/routing/routes",
          content_hash: contentHash,
          hash: hash,
          previous_hash: previousHash,
          user_id: userId,
          headers: JSON.stringify({}),
          deleted: false,
          purged: false,
          created_at: timestamp,
        },
      );

      // Invalidate link resolution cache for this pod
      const cache = getCache();
      if (cache) {
        // Clear all cached link resolutions for this pod
        // Invalidate each specific link path
        for (const linkPath of Object.keys(links)) {
          await cache.delete("pods", cacheKeys.link(podName, linkPath));
        }
      }

      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to update links", { error, podName });
    return failure(new Error("Failed to update links"));
  }
}
