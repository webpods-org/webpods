/**
 * Helper functions for creating test data with the new hierarchical schema
 */

// Using any for database type to avoid dependency issues
type IDatabase = any;
import { createHash } from "crypto";

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
    const existing: { id: number } | null = await db.oneOrNone(
      `SELECT id FROM stream 
       WHERE pod_name = $(podName) 
       AND name = $(name) 
       AND ${parentId === null ? "parent_id IS NULL" : "parent_id = $(parentId)"}`,
      {
        podName,
        name: segment,
        parentId,
      },
    );

    if (existing) {
      currentStreamId = existing.id;
    } else {
      // Create the stream with path
      const result: { id: number } = await db.one(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), $(name), $(path), $(parentId), $(userId), $(accessPermission), $(timestamp))
         RETURNING id`,
        {
          podName,
          name: segment,
          path: currentPath,
          parentId,
          userId,
          accessPermission,
          timestamp: new Date(),
        },
      );
      currentStreamId = result.id;
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

  // Calculate content hash
  const contentHash = `sha256:${createHash("sha256")
    .update(content)
    .digest("hex")}`;

  // Get stream path to compute record path
  const stream: { path: string } = await db.one(
    `SELECT path FROM stream WHERE id = $(streamId)`,
    { streamId },
  );

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

  await db.none(
    `INSERT INTO record (stream_id, name, path, content, content_type, content_hash, hash, previous_hash, user_id, index, created_at)
     VALUES ($(streamId), $(name), $(path), $(content), $(contentType), $(contentHash), $(hash), $(previousHash), $(userId), $(index), $(timestamp))`,
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
      timestamp: new Date(),
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
