/**
 * WebPods Initial Schema
 * 
 * Creates the complete database structure for WebPods:
 * - Pods (subdomains)
 * - Streams (append-only logs within pods, with nested paths)
 * - Records (with hash chains and aliases)
 * - Users (OAuth authentication)
 * - Custom domains
 * - Rate limiting
 */

export async function up(knex) {
  // User table - container for multiple identities
  await knex.schema.createTable('user', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Identity table - stores OAuth provider identities
  await knex.schema.createTable('identity', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('provider', 50).notNullable(); // OAuth provider ID from config.json
    table.string('provider_id', 255).notNullable(); // ID from the provider
    table.string('email', 255);
    table.string('name', 255);
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['provider', 'provider_id']);
    table.index('user_id');
    table.index('email');
  });

  // Pod table - represents subdomains (e.g., alice.webpods.org)
  await knex.schema.createTable('pod', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('pod_id', 63).unique().notNullable(); // DNS subdomain limit
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('pod_id');
  });

  // Stream table - represents streams within pods (supports nested paths)
  await knex.schema.createTable('stream', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('pod_id').references('id').inTable('pod').onDelete('CASCADE');
    table.string('stream_id', 256).notNullable(); // Stream path (can include slashes)
    table.uuid('creator_id').references('id').inTable('user').onDelete('RESTRICT');
    table.string('access_permission', 500).defaultTo('public');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['pod_id', 'stream_id']);
    table.index(['pod_id', 'stream_id']);
    table.index('creator_id');
  });

  // Record table - append-only records with hash chain
  await knex.schema.createTable('record', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('stream_id').references('id').inTable('stream').onDelete('CASCADE');
    table.integer('index').notNullable(); // Position in stream (0-based)
    table.text('content'); // Can be text or JSON
    table.string('content_type', 100).defaultTo('text/plain');
    table.string('name', 256).notNullable(); // Required name (like a filename)
    table.string('hash', 100).notNullable(); // SHA-256 hash with prefix
    table.string('previous_hash', 100); // NULL for first record
    table.uuid('author_id').references('id').inTable('user').onDelete('RESTRICT'); // User who created the record
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.unique(['stream_id', 'index']);
    table.index(['stream_id', 'index']);
    table.index(['stream_id', 'name']);
    table.index('author_id');
    table.index('hash');
  });

  // Custom domain mapping
  await knex.schema.createTable('custom_domain', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('pod_id').references('id').inTable('pod').onDelete('CASCADE');
    table.string('domain', 255).unique().notNullable();
    table.boolean('verified').defaultTo(false); // CNAME verification status
    table.boolean('ssl_provisioned').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('domain');
    table.index('pod_id');
  });

  // Rate limiting
  await knex.schema.createTable('rate_limit', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('identifier', 255).notNullable(); // user_id or ip_address
    table.string('action', 50).notNullable(); // 'write', 'read', 'pod_create', 'stream_create'
    table.integer('count').defaultTo(0);
    table.timestamp('window_start').notNullable();
    table.timestamp('window_end').notNullable();
    
    table.unique(['identifier', 'action', 'window_start']);
    table.index(['identifier', 'action', 'window_end']);
  });

  // Session storage for SSO
  await knex.schema.createTable('session', (table) => {
    table.string('sid').primary(); // Session ID
    table.jsonb('sess').notNullable(); // Session data
    table.timestamp('expire').notNullable(); // Expiry timestamp
    
    table.index('expire'); // For cleanup of expired sessions
  });

  // PKCE state storage for OAuth flows
  await knex.schema.createTable('oauth_state', (table) => {
    table.string('state').primary(); // State parameter
    table.string('code_verifier', 128).notNullable(); // PKCE code verifier
    table.string('pod', 63); // Optional pod for pod-specific auth
    table.text('redirect_url'); // Where to redirect after auth
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable(); // TTL for state
    
    table.index('expires_at'); // For cleanup of expired states
  });

  // Update triggers for updated_at columns
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  await knex.raw(`
    CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "user"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER update_identity_updated_at BEFORE UPDATE ON identity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER update_pod_updated_at BEFORE UPDATE ON pod
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER update_stream_updated_at BEFORE UPDATE ON stream
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER update_custom_domain_updated_at BEFORE UPDATE ON custom_domain
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex) {
  // Drop triggers
  await knex.raw('DROP TRIGGER IF EXISTS update_custom_domain_updated_at ON custom_domain');
  await knex.raw('DROP TRIGGER IF EXISTS update_stream_updated_at ON stream');
  await knex.raw('DROP TRIGGER IF EXISTS update_pod_updated_at ON pod');
  await knex.raw('DROP TRIGGER IF EXISTS update_identity_updated_at ON identity');
  await knex.raw('DROP TRIGGER IF EXISTS update_user_updated_at ON "user"');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('oauth_state');
  await knex.schema.dropTableIfExists('session');
  await knex.schema.dropTableIfExists('rate_limit');
  await knex.schema.dropTableIfExists('custom_domain');
  await knex.schema.dropTableIfExists('record');
  await knex.schema.dropTableIfExists('stream');
  await knex.schema.dropTableIfExists('pod');
  await knex.schema.dropTableIfExists('identity');
  await knex.schema.dropTableIfExists('user');
}