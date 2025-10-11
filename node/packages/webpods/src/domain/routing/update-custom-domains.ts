/**
 * Update custom domains for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeInsert } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:routing");
const schema = createSchema<DatabaseSchema>();

export async function updateCustomDomains(
  ctx: DataContext,
  podName: string,
  userId: string,
  domains: string[],
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

      // Verify ownership - first get .config stream
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

      const configStream = configStreamResults[0] || null;

      if (!configStream) {
        return failure(new Error("Config stream not found"));
      }

      // Get owner stream (child of .config)
      const ownerStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parent_id && s.name === "owner")
            .take(1),
        { parent_id: configStream.id },
      );

      const ownerStream = ownerStreamResults[0] || null;

      if (!ownerStream) {
        return failure(new Error("Owner stream not found"));
      }

      // Get owner record
      const ownerRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id && r.name === "owner")
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: ownerStream.id },
      );

      const ownerRecord = ownerRecordResults[0] || null;

      if (!ownerRecord) {
        return failure(new Error("Owner record not found"));
      }

      try {
        const content = JSON.parse(ownerRecord.content);
        if (content.userId !== userId) {
          return failure(
            new Error("Only the pod owner can update custom domains"),
          );
        }
      } catch {
        return failure(new Error("Failed to verify ownership"));
      }

      // Get or create domains stream (child of .config)
      const domainsStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parent_id && s.name === "domains")
            .take(1),
        { parent_id: configStream.id },
      );

      let domainsStream = domainsStreamResults[0] || null;

      // Get old domains for cache invalidation
      let oldDomains: string[] = [];
      if (domainsStream) {
        // Get the most recent domains record to find old domains
        const lastDomainsRecordResults = await executeSelect(
          t,
          schema,
          (q, p) =>
            q
              .from("record")
              .where((r) => r.stream_id === p.stream_id && r.name === "domains")
              .orderByDescending((r) => r.index)
              .take(1),
          { stream_id: domainsStream.id },
        );

        const lastDomainsRecord = lastDomainsRecordResults[0] || null;

        if (lastDomainsRecord) {
          try {
            const content = JSON.parse(lastDomainsRecord.content);
            oldDomains = content.domains || [];
          } catch {
            // Ignore parse errors
          }
        }
      } else {
        // Create the stream with hierarchical structure
        const now = Date.now();

        const domainsStreamCreateResults = await executeInsert(
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
                has_schema: p.has_schema,
                metadata: p.metadata,
                created_at: p.created_at,
                updated_at: p.updated_at,
              })
              .returning((s) => s),
          {
            pod_name: podName,
            name: "domains",
            path: ".config/domains",
            parent_id: configStream.id,
            user_id: userId,
            access_permission: "private",
            has_schema: false,
            metadata: "{}",
            created_at: now,
            updated_at: now,
          },
        );

        domainsStream = domainsStreamCreateResults[0] || null;
      }

      // Ensure domainsStream exists (either found or created)
      if (!domainsStream) {
        return failure(new Error("Failed to create domains stream"));
      }

      // Get the last record for hash chain
      const lastRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id)
            .select((r) => ({ index: r.index, hash: r.hash }))
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: domainsStream.id },
      );

      const lastRecord = lastRecordResults[0] || null;

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;

      // Store the complete list of domains in a single record
      const timestamp = Date.now();
      const content = { domains };
      const contentHash = calculateContentHash(content);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const contentString = JSON.stringify(content);
      const size = Buffer.byteLength(contentString, "utf8");

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
          stream_id: domainsStream.id,
          index: index,
          content: contentString,
          content_type: "application/json",
          is_binary: false,
          size: size,
          name: `domains`,
          path: `.config/domains/domains`,
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

      // Invalidate cache for all affected domains
      const cache = getCache();
      if (cache) {
        // Invalidate old domains that may no longer point to this pod
        for (const oldDomain of oldDomains) {
          await cache.delete("pods", cacheKeys.domainPod(oldDomain));
        }

        // Invalidate new domains to force fresh lookup
        for (const newDomain of domains) {
          await cache.delete("pods", cacheKeys.domainPod(newDomain));
        }
      }

      logger.info("Custom domains updated", {
        podName,
        domains: domains.length,
      });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to update custom domains", { error, podName });
    return failure(new Error("Failed to update custom domains"));
  }
}
