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
