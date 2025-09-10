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
    table.string('name', 63).primary(); // DNS subdomain limit - name is now the primary key
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Stream table - represents hierarchical streams within pods (like directories)
  await knex.schema.createTable('stream', (table) => {
    table.bigIncrements('id').primary();
    table.string('pod_name', 63).references('name').inTable('pod').onDelete('CASCADE');
    table.string('name', 256).notNullable(); // Stream name (no slashes allowed)
    table.string('path', 2048).notNullable(); // Full path for O(1) lookups
    table.bigint('parent_id').references('id').inTable('stream').onDelete('CASCADE'); // Parent stream
    table.uuid('user_id').references('id').inTable('user').onDelete('RESTRICT');
    table.string('access_permission', 500).defaultTo('public');
    table.boolean('has_schema').defaultTo(false); // Whether this stream has validation schema
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Can't have two streams with same name in same parent within a pod
    table.unique(['pod_name', 'parent_id', 'name']);
    // Unique path within a pod for direct lookups
    table.unique(['pod_name', 'path']);
    // Index for efficient child lookups
    table.index(['pod_name', 'parent_id']);
    // Index for fast path-based lookups
    table.index(['pod_name', 'path']);
    table.index('user_id');
    // Index for finding streams with schemas
    table.index(['pod_name', 'has_schema']);
  });

  // Record table - append-only records with hash chain (like files)
  await knex.schema.createTable('record', (table) => {
    table.bigIncrements('id').primary();
    table.bigint('stream_id').references('id').inTable('stream').onDelete('CASCADE');
    table.integer('index').notNullable(); // Position in stream (0-based)
    table.text('content'); // Can be text or JSON
    table.string('content_type', 100).defaultTo('text/plain');
    table.string('name', 256).notNullable(); // Required name (no slashes - like a filename)
    table.string('path', 2048).notNullable(); // Full path including record name for O(1) lookups
    table.string('content_hash', 100).notNullable(); // SHA-256 hash of content only
    table.string('hash', 100).notNullable(); // SHA-256 hash of (previous_hash + content_hash)
    table.string('previous_hash', 100); // NULL for first record
    table.uuid('user_id').references('id').inTable('user').onDelete('RESTRICT'); // User who created the record
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.unique(['stream_id', 'index']);
    table.index(['stream_id', 'index']);
    table.index(['stream_id', 'name']);
    table.index(['stream_id', 'path']); // Index for fast path-based record lookups
    table.index('user_id');
    table.index('hash');
  });

  // Custom domain mapping
  await knex.schema.createTable('custom_domain', (table) => {
    table.bigIncrements('id').primary();
    table.string('pod_name', 63).references('name').inTable('pod').onDelete('CASCADE');
    table.string('domain', 255).unique().notNullable();
    table.boolean('verified').defaultTo(false); // CNAME verification status
    table.boolean('ssl_provisioned').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('domain');
    table.index('pod_name');
  });

  // Rate limiting
  await knex.schema.createTable('rate_limit', (table) => {
    table.bigIncrements('id').primary();
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
    table.text('redirect_uri'); // Where to redirect after auth
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable(); // TTL for state
    
    table.index('expires_at'); // For cleanup of expired states
  });

  // OAuth client storage for registered applications
  await knex.schema.createTable('oauth_client', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('client_id', 255).unique().notNullable(); // Unique client identifier
    table.string('client_name', 255).notNullable(); // Display name
    table.string('client_secret', 255); // NULL for public clients (SPAs)
    table.specificType('redirect_uris', 'text[]').notNullable(); // Array of allowed redirect URIs
    table.specificType('requested_pods', 'text[]').notNullable(); // Array of pods the client needs access to
    table.specificType('grant_types', 'text[]').defaultTo(knex.raw("ARRAY['authorization_code','refresh_token']::text[]"));
    table.specificType('response_types', 'text[]').defaultTo(knex.raw("ARRAY['code']::text[]"));
    table.string('token_endpoint_auth_method', 50).defaultTo('client_secret_basic');
    table.string('scope', 500).defaultTo('openid offline pod:read pod:write');
    table.jsonb('metadata').defaultTo('{}'); // Additional client metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('user_id');
    table.index('client_id');
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

  await knex.raw(`
    CREATE TRIGGER update_oauth_client_updated_at BEFORE UPDATE ON oauth_client
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex) {
  // Drop triggers
  await knex.raw('DROP TRIGGER IF EXISTS update_oauth_client_updated_at ON oauth_client');
  await knex.raw('DROP TRIGGER IF EXISTS update_custom_domain_updated_at ON custom_domain');
  await knex.raw('DROP TRIGGER IF EXISTS update_stream_updated_at ON stream');
  await knex.raw('DROP TRIGGER IF EXISTS update_pod_updated_at ON pod');
  await knex.raw('DROP TRIGGER IF EXISTS update_identity_updated_at ON identity');
  await knex.raw('DROP TRIGGER IF EXISTS update_user_updated_at ON "user"');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('oauth_client');
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