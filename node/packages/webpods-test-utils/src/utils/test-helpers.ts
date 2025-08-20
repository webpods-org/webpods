import { Knex } from "knex";
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
  db: Knex,
  options?: {
    provider?: string;
    providerId?: string;
    email?: string;
    name?: string;
  }
): Promise<TestUser> {
  const userId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const provider = options?.provider || "testprovider";
  const providerId = options?.providerId || crypto.randomUUID();
  const email = options?.email || `test-${providerId}@example.com`;
  const name = options?.name || "Test User";

  // Create user
  await db("user").insert({
    id: userId,
  });

  // Create identity
  await db("identity").insert({
    id: identityId,
    user_id: userId,
    provider,
    provider_id: providerId,
    email,
    name,
  });

  return {
    userId,
    identityId,
    provider,
    providerId,
    email,
    name,
  };
}