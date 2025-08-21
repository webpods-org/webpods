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
  podId: string,
  ownerId: string,
): Promise<void> {
  const podUuid = crypto.randomUUID();
  const streamUuid = crypto.randomUUID();

  // Create pod
  await db.none(
    `INSERT INTO pod (id, pod_id, created_at, updated_at) 
     VALUES ($(podUuid), $(podId), NOW(), NOW())`,
    { podUuid, podId },
  );

  // Create .meta/owner stream
  await db.none(
    `INSERT INTO stream (id, pod_id, stream_id, creator_id, access_permission, created_at, updated_at)
     VALUES ($(streamUuid), $(podUuid), '.meta/owner', $(ownerId), 'private', NOW(), NOW())`,
    { streamUuid, podUuid, ownerId },
  );

  // Add ownership record
  const content = JSON.stringify({ owner: ownerId });
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  await db.none(
    `INSERT INTO record (stream_id, index, content, content_type, name, hash, previous_hash, author_id, created_at)
     VALUES ($(streamUuid), 0, $(content), 'application/json', 'owner', $(hash), NULL, $(ownerId), NOW())`,
    { streamUuid, content, hash, ownerId },
  );
}
