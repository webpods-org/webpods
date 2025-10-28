import pgPromise from "pg-promise";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { createSchema } from "@tinqerjs/tinqer";
import { executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "./db-schema.js";

export interface TestUser {
  userId: string;
  identityId: string;
  provider: string;
  providerId: string;
  email: string;
  name: string;
}

const schema = createSchema<DatabaseSchema>();

/**
 * Create a test user with identity in the database
 */
export async function createTestUser(
  db: pgPromise.IDatabase<any>,
  options?: {
    provider?: string;
    providerId?: string;
    email?: string;
    name?: string;
  },
): Promise<TestUser> {
  const userId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const provider = options?.provider || "testprovider";
  const providerId = options?.providerId || crypto.randomUUID();
  const email = options?.email || `test-${providerId}@example.com`;
  const name = options?.name || "Test User";

  // Create user
  const now = Date.now();
  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("user").values({
        id: p.userId,
        created_at: p.now,
        updated_at: p.now,
      }),
    { userId, now },
  );

  // Create identity
  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("identity").values({
        id: p.identityId,
        user_id: p.userId,
        provider: p.provider,
        provider_id: p.providerId,
        email: p.email,
        name: p.name,
        metadata: "{}",
        created_at: p.now,
        updated_at: p.now,
      }),
    {
      identityId,
      userId,
      provider,
      providerId,
      email,
      name,
      now,
    },
  );

  return {
    userId,
    identityId,
    provider,
    providerId,
    email,
    name,
  };
}

/**
 * Create a test pod with owner in the database
 */
export async function createTestPod(
  db: pgPromise.IDatabase<any>,
  podName: string,
  ownerId: string,
): Promise<void> {
  const now = Date.now();
  // Create pod
  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("pod").values({
        name: p.podName,
        owner_id: p.ownerId,
        metadata: "{}",
        created_at: p.now,
        updated_at: p.now,
      }),
    { podName, ownerId, now },
  );

  // Create .config stream first (parent)
  const configStreams = await executeInsert(
    db,
    schema,
    (q, p) =>
      q
        .insertInto("stream")
        .values({
          pod_name: p.podName,
          name: ".config",
          path: ".config",
          parent_id: null,
          user_id: p.ownerId,
          access_permission: "private",
          metadata: "{}",
          has_schema: false,
          created_at: p.now,
          updated_at: p.now,
        })
        .returning((s) => ({ id: s.id })),
    { podName, ownerId, now },
  );

  const configStream = configStreams[0];
  if (!configStream) {
    throw new Error("Failed to create .config stream");
  }

  // Create owner stream under .config
  const ownerStreams = await executeInsert(
    db,
    schema,
    (q, p) =>
      q
        .insertInto("stream")
        .values({
          pod_name: p.podName,
          name: "owner",
          path: ".config/owner",
          parent_id: p.parentId,
          user_id: p.ownerId,
          access_permission: "private",
          metadata: "{}",
          has_schema: false,
          created_at: p.now,
          updated_at: p.now,
        })
        .returning((s) => ({ id: s.id })),
    { podName, parentId: configStream.id, ownerId, now },
  );

  const ownerStream = ownerStreams[0];
  if (!ownerStream) {
    throw new Error("Failed to create owner stream");
  }

  // Add ownership record
  const ownerObj = { userId: ownerId };
  const content = JSON.stringify(ownerObj);
  const contentHash =
    "sha256:" + crypto.createHash("sha256").update(content).digest("hex");

  // Calculate record hash (previousHash + contentHash + userId + timestamp)
  const hashData = JSON.stringify({
    previous_hash: null,
    content_hash: contentHash,
    user_id: ownerId,
    timestamp: now,
  });
  const hash =
    "sha256:" + crypto.createHash("sha256").update(hashData).digest("hex");

  const size = Buffer.byteLength(content, "utf8");

  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("record").values({
        stream_id: p.streamId,
        index: 0,
        content: p.content,
        content_type: "application/json",
        is_binary: false,
        size: p.size,
        name: "owner",
        path: ".config/owner/owner",
        content_hash: p.contentHash,
        hash: p.hash,
        previous_hash: null,
        user_id: p.ownerId,
        headers: "{}",
        deleted: false,
        purged: false,
        created_at: p.now,
      }),
    {
      streamId: ownerStream.id,
      content,
      size,
      contentHash,
      hash,
      ownerId,
      now,
    },
  );
}

/**
 * Generate a WebPods JWT token for testing
 * @param userId The user ID to include in the token
 * @returns JWT token string
 */
export function generateTestWebPodsToken(userId: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-key";

  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    type: "webpods",
  };

  return jwt.sign(payload, secret);
}
