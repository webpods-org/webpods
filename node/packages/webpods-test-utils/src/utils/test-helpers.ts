import pgPromise from "pg-promise";
import crypto from "crypto";
import jwt from "jsonwebtoken";

export interface TestUser {
  userId: string;
  identityId: string;
  provider: string;
  providerId: string;
  email: string;
  name: string;
}

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
  await db.none(
    `INSERT INTO "user" (id, created_at, updated_at) 
     VALUES ($(userId), NOW(), NOW())`,
    { userId },
  );

  // Create identity
  await db.none(
    `INSERT INTO identity (id, user_id, provider, provider_id, email, name, created_at, updated_at) 
     VALUES ($(identityId), $(userId), $(provider), $(providerId), $(email), $(name), NOW(), NOW())`,
    {
      identityId,
      userId,
      provider,
      providerId,
      email,
      name,
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
  // Create pod
  await db.none(
    `INSERT INTO pod (name, created_at, updated_at) 
     VALUES ($(podName), NOW(), NOW())`,
    { podName },
  );

  // Create .config stream first (parent)
  const configStream = await db.one(
    `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at, updated_at)
     VALUES ($(podName), '.config', '.config', NULL, $(ownerId), 'private', NOW(), NOW())
     RETURNING id`,
    { podName, ownerId },
  );

  // Create owner stream under .config
  const ownerStream = await db.one(
    `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at, updated_at)
     VALUES ($(podName), 'owner', '.config/owner', $(parentId), $(ownerId), 'private', NOW(), NOW())
     RETURNING id`,
    { podName, parentId: configStream.id, ownerId },
  );

  // Add ownership record
  const ownerObj = { userId: ownerId };
  const content = JSON.stringify(ownerObj);
  const contentHash =
    "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
  const timestamp = new Date().toISOString();

  // Calculate record hash (previousHash + contentHash + userId + timestamp)
  const hashData = JSON.stringify({
    previous_hash: null,
    content_hash: contentHash,
    user_id: ownerId,
    timestamp: timestamp,
  });
  const hash =
    "sha256:" + crypto.createHash("sha256").update(hashData).digest("hex");

  await db.none(
    `INSERT INTO record (stream_id, index, content, content_type, name, path, content_hash, hash, previous_hash, user_id, created_at)
     VALUES ($(streamId), 0, $(content), 'application/json', 'owner', '.config/owner/owner', $(contentHash), $(hash), NULL, $(ownerId), $(timestamp))`,
    {
      streamId: ownerStream.id,
      content,
      contentHash,
      hash,
      ownerId,
      timestamp,
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
