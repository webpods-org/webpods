import pgPromise from "pg-promise";
import crypto from "crypto";

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

  // Create .meta/owner stream
  await db.none(
    `INSERT INTO stream (pod_name, name, user_id, access_permission, created_at, updated_at)
     VALUES ($(podName), '.meta/owner', $(ownerId), 'private', NOW(), NOW())`,
    { podName, ownerId },
  );

  // Add ownership record
  const content = JSON.stringify({ owner: ownerId });
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  await db.none(
    `INSERT INTO record (pod_name, stream_name, index, content, content_type, name, hash, previous_hash, user_id, created_at)
     VALUES ($(podName), '.meta/owner', 0, $(content), 'application/json', 'owner', $(hash), NULL, $(ownerId), NOW())`,
    { podName, content, hash, ownerId },
  );
}
