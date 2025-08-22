/**
 * URL routing and custom domain logic
 */

import { Database } from "../db.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../db-types.js";
import { Result } from "../types.js";
import { createLogger } from "../logger.js";
import { calculateRecordHash } from "../utils.js";

const logger = createLogger("webpods:domain:routing");

interface LinkMapping {
  streamId: string;
  target: string;
}

/**
 * Resolve a path using .meta/links configuration
 */
export async function resolveLink(
  db: Database,
  podId: string,
  path: string,
): Promise<Result<LinkMapping | null>> {
  try {
    // Get the latest .meta/links record
    const record = await db.oneOrNone<RecordDbRow>(
      `SELECT r.*
       FROM record r
       JOIN stream s ON s.id = r.stream_id
       JOIN pod p ON p.id = s.pod_id
       WHERE p.pod_id = $(podId)
         AND s.stream_id = '.meta/links'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      { podId },
    );

    if (!record) {
      return { success: true, data: null };
    }

    const links =
      typeof record.content === "string"
        ? JSON.parse(record.content)
        : record.content;

    if (!links[path]) {
      return { success: true, data: null };
    }

    // Parse the mapping (e.g., "homepage/-1", "blog/my-post", or "homepage?i=-1")
    const mapping = links[path];

    // Check if it has query parameters
    if (mapping.includes("?")) {
      // Handle format like "homepage?i=-1"
      const [streamId, query] = mapping.split("?");
      return {
        success: true,
        data: {
          streamId: streamId!,
          target: query ? `?${query}` : "",
        },
      };
    }

    // Handle format like "homepage/-1" or "homepage/my-post"
    const parts = mapping.split("/");

    if (parts.length === 1) {
      // Just stream name, no target
      return {
        success: true,
        data: {
          streamId: parts[0]!,
          target: "",
        },
      };
    } else if (parts.length === 2) {
      return {
        success: true,
        data: {
          streamId: parts[0]!,
          target: parts[1]!,
        },
      };
    } else {
      logger.warn("Invalid link mapping", { podId, path, mapping });
      return { success: true, data: null };
    }
  } catch (error: any) {
    logger.error("Failed to resolve link", { error, podId, path });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to resolve link",
      },
    };
  }
}

/**
 * Update .meta/links configuration
 */
export async function updateLinks(
  db: Database,
  podId: string,
  links: Record<string, string>,
  userId: string,
  authorId: string,
): Promise<Result<void>> {
  try {
    return await db.tx(async (t) => {
      // Get pod
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId },
      );

      if (!pod) {
        return {
          success: false,
          error: {
            code: "POD_NOT_FOUND",
            message: "Pod not found",
          },
        };
      }

      // Get or create .meta/links stream
      let linksStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(podId)
           AND stream_id = '.meta/links'`,
        { podId: pod.id },
      );

      if (!linksStream) {
        linksStream = await t.one<StreamDbRow>(
          `INSERT INTO stream (id, pod_id, stream_id, user_id, access_permission, created_at)
           VALUES (gen_random_uuid(), $(podId), '.meta/links', $(userId), 'private', NOW())
           RETURNING *`,
          { podId: pod.id, userId },
        );
      }

      // Get previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId: linksStream.id },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, links);

      // Write new links record
      await t.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, hash, previous_hash, author_id, created_at)
         VALUES ($(streamId), $(index), $(content), 'application/json', $(name), $(hash), $(previousHash), $(authorId), $(timestamp))`,
        {
          streamId: linksStream.id,
          index,
          content: JSON.stringify(links),
          name: `links-${index}`,
          hash,
          previousHash,
          authorId,
          timestamp,
        },
      );

      logger.info("Links updated", { podId, paths: Object.keys(links) });
      return { success: true, data: undefined };
    });
  } catch (error: any) {
    logger.error("Failed to update links", { error, podId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to update links",
      },
    };
  }
}

/**
 * Find pod by custom domain
 */
export async function findPodByDomain(
  db: Database,
  domain: string,
): Promise<Result<string | null>> {
  try {
    const customDomain = await db.oneOrNone<{ pod_id: string }>(
      `SELECT pod_id FROM custom_domain
       WHERE domain = $(domain)
         AND ssl_provisioned = true`,
      { domain },
    );

    if (!customDomain) {
      return { success: true, data: null };
    }

    const pod = await db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE id = $(podId)`,
      { podId: customDomain.pod_id },
    );

    if (!pod) {
      return { success: true, data: null };
    }

    return { success: true, data: pod.pod_id };
  } catch (error: any) {
    logger.error("Failed to find pod by domain", { error, domain });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to find pod by domain",
      },
    };
  }
}

/**
 * Update custom domains for a pod
 */
export async function updateCustomDomains(
  db: Database,
  podId: string,
  domains: string[],
  userId: string,
  authorId: string,
): Promise<Result<void>> {
  try {
    return await db.tx(async (t) => {
      // Get pod
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId },
      );

      if (!pod) {
        return {
          success: false,
          error: {
            code: "POD_NOT_FOUND",
            message: "Pod not found",
          },
        };
      }

      // Get or create .meta/domains stream
      let domainsStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(podId)
           AND stream_id = '.meta/domains'`,
        { podId: pod.id },
      );

      if (!domainsStream) {
        domainsStream = await t.one<StreamDbRow>(
          `INSERT INTO stream (id, pod_id, stream_id, user_id, access_permission, created_at)
           VALUES (gen_random_uuid(), $(podId), '.meta/domains', $(userId), 'private', NOW())
           RETURNING *`,
          { podId: pod.id, userId },
        );
      }

      // Get previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId: domainsStream.id },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, { domains });

      // Write new domains record
      await t.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, hash, previous_hash, author_id, created_at)
         VALUES ($(streamId), $(index), $(content), 'application/json', $(name), $(hash), $(previousHash), $(authorId), $(timestamp))`,
        {
          streamId: domainsStream.id,
          index,
          content: JSON.stringify({ domains }),
          name: `domains-${index}`,
          hash,
          previousHash,
          authorId,
          timestamp,
        },
      );

      // Update custom_domain table (for faster lookups)
      // Remove old domains
      await t.none(`DELETE FROM custom_domain WHERE pod_id = $(podId)`, {
        podId: pod.id,
      });

      // Add new domains
      if (domains.length > 0) {
        const values = domains.map((domain) => ({
          id: crypto.randomUUID(),
          pod_id: pod.id,
          domain: domain,
          ssl_provisioned: false, // Needs CNAME verification
          created_at: new Date(),
        }));

        // Build insert query for multiple domains
        for (const value of values) {
          await t.none(
            `INSERT INTO custom_domain (id, pod_id, domain, ssl_provisioned, created_at)
             VALUES ($(id), $(pod_id), $(domain), $(ssl_provisioned), $(created_at))`,
            value,
          );
        }
      }

      logger.info("Custom domains updated", { podId, domains });
      return { success: true, data: undefined };
    });
  } catch (error: any) {
    logger.error("Failed to update custom domains", { error, podId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to update custom domains",
      },
    };
  }
}
