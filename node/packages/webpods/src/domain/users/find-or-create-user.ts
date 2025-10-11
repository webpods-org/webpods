/**
 * Find or create a user from OAuth profile
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { UserDbRow, IdentityDbRow } from "../../db-types.js";
import { User, Identity, OAuthProvider, OAuthUserInfo } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createSchema } from "@webpods/tinqer";
import {
  executeSelect,
  executeUpdate,
  executeInsert,
} from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:users");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapUserFromDb(row: UserDbRow): User {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIdentityFromDb(row: IdentityDbRow): Identity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerId: row.provider_id,
    email: row.email || null,
    name: row.name || null,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findOrCreateUser(
  ctx: DataContext,
  provider: OAuthProvider,
  profile: OAuthUserInfo,
): Promise<Result<{ user: User; identity: Identity }>> {
  const providerId = String(profile.id || "");
  // OAuth user info may have raw data with additional fields
  const rawProfile = profile.raw || {};
  const emails = rawProfile.emails as { value?: string }[] | undefined;
  const email = String(profile.email || emails?.[0]?.value || "");
  const name = String(
    profile.name || profile.username || rawProfile.displayName || "",
  );

  try {
    // First check if we have an identity for this provider
    const existingIdentityRows = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("identity")
          .where(
            (i) => i.provider === p.provider && i.provider_id === p.provider_id,
          ),
      { provider: provider.provider, provider_id: providerId },
    );

    const existingIdentityRow = existingIdentityRows[0] || null;

    if (existingIdentityRow) {
      const existingIdentity = mapIdentityFromDb(existingIdentityRow);

      // Get the associated user
      const userRows = await executeSelect(
        ctx.db,
        schema,
        (q, p) => q.from("user").where((u) => u.id === p.user_id),
        { user_id: existingIdentity.userId },
      );

      if (!userRows[0]) {
        return failure(new Error("User not found"));
      }

      const user = mapUserFromDb(userRows[0]);

      // Update identity info if changed
      if (
        (email && email !== existingIdentityRow.email) ||
        (name && name !== existingIdentityRow.name)
      ) {
        await executeUpdate(
          ctx.db,
          schema,
          (q, p) =>
            q
              .update("identity")
              .set({
                email: p.email,
                name: p.name,
                updated_at: p.updated_at,
              })
              .where(
                (i) =>
                  i.provider === p.provider && i.provider_id === p.provider_id,
              ),
          {
            email: email,
            name: name,
            updated_at: Date.now(),
            provider: provider.provider,
            provider_id: providerId,
          },
        );
      }

      return success({ user, identity: existingIdentity });
    }

    // No existing identity, create transaction for new user
    return await ctx.db.tx(async (t) => {
      // Check if user exists with this email via another identity
      // Break JOIN into two queries: first get identities by email, then get user
      let existingUserByEmail: UserDbRow | null = null;
      if (email) {
        const identitiesWithEmail = await executeSelect(
          t,
          schema,
          (q, p) =>
            q
              .from("identity")
              .select((i) => ({ user_id: i.user_id }))
              .where((i) => i.email === p.email)
              .take(1),
          { email },
        );

        if (identitiesWithEmail.length > 0) {
          const userResults = await executeSelect(
            t,
            schema,
            (q, p) =>
              q
                .from("user")
                .where((u) => u.id === p.user_id)
                .take(1),
            { user_id: identitiesWithEmail[0].user_id },
          );
          existingUserByEmail = userResults[0] || null;
        }
      }

      let user: User;
      let userId: string;

      if (existingUserByEmail) {
        // User exists with different provider
        user = mapUserFromDb(existingUserByEmail);
        userId = existingUserByEmail.id;
        logger.info("Linking new provider to existing user");
      } else {
        // Create new user
        const now = Date.now();
        const newUserId = crypto.randomUUID();

        const newUserRows = await executeInsert(
          t,
          schema,
          (q, p) =>
            q
              .insertInto("user")
              .values({
                id: p.id,
                created_at: p.created_at,
                updated_at: p.updated_at,
              })
              .returning((u) => u),
          {
            id: newUserId,
            created_at: now,
            updated_at: now,
          },
        );

        user = mapUserFromDb(newUserRows[0]);
        userId = user.id;
        logger.info("Created new user");
      }

      // Create identity
      const now = Date.now();
      const identityId = crypto.randomUUID();

      const identityRows = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("identity")
            .values({
              id: p.id,
              user_id: p.user_id,
              provider: p.provider,
              provider_id: p.provider_id,
              email: p.email,
              name: p.name,
              metadata: p.metadata,
              created_at: p.created_at,
              updated_at: p.updated_at,
            })
            .returning((i) => i),
        {
          id: identityId,
          user_id: userId,
          provider: provider.provider,
          provider_id: providerId,
          email: email || null,
          name: name || null,
          metadata: JSON.stringify(profile),
          created_at: now,
          updated_at: now,
        },
      );

      const identity = mapIdentityFromDb(identityRows[0]);
      logger.info("Created new identity");

      return success({ user, identity });
    });
  } catch (error) {
    logger.error("Failed to find or create user", {
      error,
      provider: provider.provider,
      providerId,
    });
    return failure(new Error("Failed to find or create user"));
  }
}
