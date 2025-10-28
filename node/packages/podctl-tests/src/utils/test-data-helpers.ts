/**
 * Helper functions for creating test data with the new hierarchical schema
 */

// Using any for database type to avoid dependency issues
type IDatabase = any;
import { createHash } from "crypto";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

interface StreamData {
  podName: string;
  streamPath: string;
  userId: string;
  accessPermission?: "public" | "private" | "permission";
}

interface RecordData {
  streamId: number;
  name?: string; // Name is required in new schema, use generated name if not provided
  content: string;
  contentType?: string;
  userId: string;
  index?: number;
  previousHash?: string | null;
}

/**
 * Creates a stream with the new hierarchical structure
 * Handles nested paths by creating parent streams as needed
 */
export async function createTestStream(
  db: IDatabase,
  data: StreamData,
): Promise<number> {
  const { podName, streamPath, userId, accessPermission = "public" } = data;

  // Split the path into segments
  const segments = streamPath.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) {
    throw new Error("Stream path cannot be empty");
  }

  let parentId: number | null = null;
  let currentStreamId: number | null = null;

  // Create each level of the hierarchy
  let currentPath = "";
  for (const segment of segments) {
    // Build the path for this level
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    // Check if this stream already exists at this level
    const existingResults: { id: number }[] =
      parentId === null
        ? await executeSelect(
            db,
            schema,
            (q, p) =>
              q
                .from("stream")
                .where(
                  (s) =>
                    s.pod_name === p.podName &&
                    s.name === p.name &&
                    s.parent_id === null,
                )
                .select((s) => ({ id: s.id }))
                .take(1),
            { podName, name: segment },
          )
        : await executeSelect(
            db,
            schema,
            (q, p) =>
              q
                .from("stream")
                .where(
                  (s) =>
                    s.pod_name === p.podName &&
                    s.name === p.name &&
                    s.parent_id === p.parentId,
                )
                .select((s) => ({ id: s.id }))
                .take(1),
            { podName, name: segment, parentId },
          );

    const existing: { id: number } | null = existingResults[0] || null;

    if (existing) {
      currentStreamId = existing.id;
    } else {
      // Create the stream with path
      const now = Date.now();
      const resultRows: { id: number }[] = await executeInsert(
        db,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.podName,
              name: p.name,
              path: p.path,
              parent_id: p.parentId,
              user_id: p.userId,
              access_permission: p.accessPermission,
              created_at: p.timestamp,
              updated_at: p.timestamp,
              metadata: "{}",
              has_schema: false,
            })
            .returning((s) => ({ id: s.id })),
        {
          podName,
          name: segment,
          path: currentPath,
          parentId,
          userId,
          accessPermission,
          timestamp: now,
        },
      );
      currentStreamId = resultRows[0]!.id;
    }

    // This stream becomes the parent for the next level
    parentId = currentStreamId;
  }

  return currentStreamId!;
}

/**
 * Creates a record in the new schema
 */
export async function createTestRecord(
  db: IDatabase,
  data: RecordData,
): Promise<void> {
  const {
    streamId,
    name = "", // Use empty string as default for unnamed records
    content,
    contentType = "text/plain",
    userId,
    index = 0,
    previousHash = null,
  } = data;

  // Calculate content hash and size
  const contentHash = `sha256:${createHash("sha256")
    .update(content)
    .digest("hex")}`;
  const size = Buffer.byteLength(content, "utf8");

  // Get stream path to compute record path
  const streamResults = await executeSelect(
    db,
    schema,
    (q, p) =>
      q
        .from("stream")
        .where((s) => s.id === p.streamId)
        .select((s) => ({ path: s.path }))
        .take(1),
    { streamId },
  );

  const stream = streamResults[0]!;
  const recordPath = name ? `${stream.path}/${name}` : stream.path;

  // Calculate record hash (simplified for testing)
  const hashInput = [
    previousHash || "",
    contentHash,
    userId,
    name || "",
    index.toString(),
  ].join(":");

  const hash = `sha256:${createHash("sha256").update(hashInput).digest("hex")}`;

  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("record").values({
        stream_id: p.streamId,
        name: p.name,
        path: p.path,
        content: p.content,
        content_type: p.contentType,
        content_hash: p.contentHash,
        hash: p.hash,
        previous_hash: p.previousHash,
        user_id: p.userId,
        index: p.index,
        size: p.size,
        deleted: p.deleted,
        purged: p.purged,
        is_binary: p.isBinary,
        headers: p.headers,
        created_at: p.timestamp,
      }),
    {
      streamId,
      name,
      path: recordPath,
      content,
      contentType,
      contentHash,
      hash,
      previousHash,
      userId,
      index,
      size,
      deleted: false,
      purged: false,
      isBinary: false,
      headers: "{}",
      timestamp: Date.now(),
    },
  );
}

/**
 * Creates a stream with an initial record
 * This is a common pattern in the tests
 */
export async function createStreamWithRecord(
  db: IDatabase,
  podName: string,
  streamPath: string,
  recordName: string | undefined,
  content: string,
  userId: string,
  accessPermission: "public" | "private" | "permission" = "public",
): Promise<{ streamId: number }> {
  // Create the stream
  const streamId = await createTestStream(db, {
    podName,
    streamPath,
    userId,
    accessPermission,
  });

  // Create the record
  await createTestRecord(db, {
    streamId,
    name: recordName || undefined, // Let function generate name if not provided
    content,
    contentType: "application/json",
    userId,
    index: 0,
  });

  return { streamId };
}

/**
 * Creates permission stream structure (.config/permissions/{streamPath})
 */
export async function createPermissionStream(
  db: IDatabase,
  podName: string,
  targetStreamPath: string,
  permissions: Array<{ id: string; permission: string }>,
  userId: string,
): Promise<void> {
  // Create .config stream if it doesn't exist
  await createTestStream(db, {
    podName,
    streamPath: ".config",
    userId,
    accessPermission: "private",
  });

  // Create .config/permissions stream
  await createTestStream(db, {
    podName,
    streamPath: ".config/permissions",
    userId,
    accessPermission: "private",
  });

  // Create the specific permission stream for the target
  const fullPath = `.config/permissions/${targetStreamPath}`;
  const streamId = await createTestStream(db, {
    podName,
    streamPath: fullPath,
    userId,
    accessPermission: "private",
  });

  // Add permission records - use user ID as the record name
  for (let i = 0; i < permissions.length; i++) {
    const perm = permissions[i]!;
    await createTestRecord(db, {
      streamId,
      name: perm.id, // Use the user ID as the record name
      content: JSON.stringify(perm),
      contentType: "application/json",
      userId,
      index: i,
      previousHash: i > 0 ? "dummy-hash" : null,
    });
  }
}

/**
 * Creates routing configuration (.config/routing/routes)
 */
export async function createRoutingConfig(
  db: IDatabase,
  podName: string,
  routes: Record<string, string>,
  userId: string,
): Promise<void> {
  // Create .config/routing/routes stream
  const streamId = await createTestStream(db, {
    podName,
    streamPath: ".config/routing/routes",
    userId,
    accessPermission: "private",
  });

  // Add routing record with name "routes" to match update-links.ts
  await createTestRecord(db, {
    streamId,
    name: "routes",
    content: JSON.stringify(routes),
    contentType: "application/json",
    userId,
    index: 0,
  });
}

/**
 * Creates domain configuration (.config/domains)
 */
export async function createDomainConfig(
  db: IDatabase,
  podName: string,
  domains: string[],
  userId: string,
): Promise<void> {
  // Create .config/domains stream
  const streamId = await createTestStream(db, {
    podName,
    streamPath: ".config/domains",
    userId,
    accessPermission: "private",
  });

  // Add domains record with name "domains" to match update-custom-domains.ts
  await createTestRecord(db, {
    streamId,
    name: "domains",
    content: JSON.stringify({ domains }),
    contentType: "application/json",
    userId,
    index: 0,
  });
}

/**
 * Creates owner configuration (.config/owner)
 */
export async function createOwnerConfig(
  db: IDatabase,
  podName: string,
  ownerId: string,
  userId: string,
): Promise<void> {
  // Create .config/owner stream
  const streamId = await createTestStream(db, {
    podName,
    streamPath: ".config/owner",
    userId,
    accessPermission: "private",
  });

  // Add owner record with name "owner" to match what create-pod does
  await createTestRecord(db, {
    streamId,
    name: "owner",
    content: JSON.stringify({ userId: ownerId }),
    contentType: "application/json",
    userId,
    index: 0,
  });
}
