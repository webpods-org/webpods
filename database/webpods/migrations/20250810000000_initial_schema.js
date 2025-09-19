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
    table.uuid('id').primary().notNullable();
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
  });

  // Identity table - stores OAuth provider identities
  await knex.schema.createTable('identity', (table) => {
    table.uuid('id').primary().notNullable();
    table.uuid('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('provider', 50).notNullable(); // OAuth provider ID from config.json
    table.string('provider_id', 255).notNullable(); // ID from the provider
    table.string('email', 255);
    table.string('name', 255);
    table.text('metadata').notNullable();
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
    
    table.unique(['provider', 'provider_id']);
    table.index('user_id');
    table.index('email');
  });

  // Pod table - represents subdomains (e.g., alice.webpods.org)
  await knex.schema.createTable('pod', (table) => {
    table.string('name', 63).primary(); // DNS subdomain limit - name is now the primary key
    table.uuid('owner_id').references('id').inTable('user').onDelete('RESTRICT'); // Pod owner - denormalized for performance
    table.text('metadata').notNullable();
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
    table.index('owner_id'); // Index for efficient owner lookups
  });

  // Stream table - represents hierarchical streams within pods (like directories)
  await knex.schema.createTable('stream', (table) => {
    table.bigIncrements('id').primary();
    table.string('pod_name', 63).references('name').inTable('pod').onDelete('CASCADE');
    table.string('name', 256).notNullable(); // Stream name (no slashes allowed)
    table.string('path', 2048).notNullable(); // Full path for O(1) lookups
    table.bigint('parent_id').references('id').inTable('stream').onDelete('CASCADE'); // Parent stream
    table.uuid('user_id').references('id').inTable('user').onDelete('RESTRICT');
    table.string('access_permission', 500).notNullable();
    table.boolean('has_schema').notNullable(); // Whether this stream has validation schema
    table.text('metadata').notNullable();
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
    
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
    table.text('content').notNullable(); // Can be text or JSON
    table.string('content_type', 100).notNullable();
    table.boolean('is_binary').notNullable(); // Whether content is base64-encoded binary
    table.bigint('size').notNullable(); // Content size in bytes
    table.string('name', 256).notNullable(); // Required name (no slashes - like a filename)
    table.string('path', 2048).notNullable(); // Full path including record name for O(1) lookups
    table.string('content_hash', 100).notNullable(); // SHA-256 hash of content only
    table.string('hash', 100).notNullable(); // SHA-256 hash of (previous_hash + content_hash)
    table.string('previous_hash', 100); // NULL for first record
    table.uuid('user_id').references('id').inTable('user').onDelete('RESTRICT'); // User who created the record
    table.text('storage'); // External storage location (adapter-specific format)
    table.text('headers').notNullable(); // User-provided headers
    table.boolean('deleted').notNullable(); // Soft delete flag
    table.boolean('purged').notNullable(); // Hard delete flag
    table.bigint('created_at').notNullable();
    
    table.unique(['stream_id', 'index']);
    table.index(['stream_id', 'index']);
    table.index(['stream_id', 'path']); // Index for fast path-based record lookups
    table.index('user_id');
    table.index('hash');
    table.index(['stream_id', 'deleted']); // Index for efficient deletion filtering
    table.index(['stream_id', 'purged']); // Index for efficient purge filtering
  });

  // Add composite index for "get latest record by name" pattern - covers both name lookups and ordering
  await knex.raw('CREATE INDEX idx_record_stream_name_index_desc ON record (stream_id, name, index DESC)');

  // Custom domain mapping
  await knex.schema.createTable('custom_domain', (table) => {
    table.bigIncrements('id').primary();
    table.string('pod_name', 63).references('name').inTable('pod').onDelete('CASCADE');
    table.string('domain', 255).unique().notNullable();
    table.boolean('verified').notNullable(); // CNAME verification status
    table.boolean('ssl_provisioned').notNullable();
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
    
    table.index('domain');
    table.index('pod_name');
  });

  // Rate limiting
  await knex.schema.createTable('rate_limit', (table) => {
    table.bigIncrements('id').primary();
    table.string('identifier', 255).notNullable(); // user_id or ip_address
    table.string('action', 50).notNullable(); // 'write', 'read', 'pod_create', 'stream_create'
    table.integer('count').notNullable();
    table.bigint('window_start').notNullable();
    table.bigint('window_end').notNullable();
    
    table.unique(['identifier', 'action', 'window_start']);
    table.index(['identifier', 'action', 'window_end']);
  });

  // Session storage for SSO (connect-pg-simple expects timestamp)
  await knex.schema.createTable('session', (table) => {
    table.string('sid').primary(); // Session ID
    table.jsonb('sess').notNullable(); // Session data
    table.timestamp('expire').notNullable(); // Expiry timestamp
    
    table.index('expire'); // For cleanup of expired sessions
  });

  // PKCE state storage for OAuth flows
  await knex.schema.createTable('oauth_state', (table) => {
    table.string('state').primary().notNullable(); // State parameter
    table.string('code_verifier', 128).notNullable(); // PKCE code verifier
    table.string('pod', 63); // Optional pod for pod-specific auth
    table.text('redirect_uri'); // Where to redirect after auth
    table.bigint('created_at').notNullable();
    table.bigint('expires_at').notNullable(); // TTL for state
    
    table.index('expires_at'); // For cleanup of expired states
  });

  // OAuth client storage for registered applications
  await knex.schema.createTable('oauth_client', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('client_id', 255).unique().notNullable(); // Unique client identifier
    table.string('client_name', 255).notNullable(); // Display name
    table.string('client_secret', 255); // NULL for public clients (SPAs)
    table.text('redirect_uris').notNullable(); // Array of allowed redirect URIs stored as JSON
    table.text('requested_pods').notNullable(); // Array of pods the client needs access to stored as JSON
    table.text('grant_types').notNullable(); // Array stored as JSON
    table.text('response_types').notNullable(); // Array stored as JSON
    table.string('token_endpoint_auth_method', 50).notNullable();
    table.string('scope', 500).notNullable();
    table.text('metadata').notNullable(); // Additional client metadata
    table.bigint('created_at').notNullable();
    table.bigint('updated_at').notNullable();
    
    table.index('user_id');
    table.index('client_id');
  });

  // No triggers - all timestamps handled in application layer
}

export async function down(knex) {
  // Drop custom indexes
  await knex.raw('DROP INDEX IF EXISTS idx_record_stream_name_index_desc');

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