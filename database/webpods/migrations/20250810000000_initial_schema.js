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
  // User table - stores OAuth authenticated users
  await knex.schema.createTable('user', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('auth_id', 255).unique().notNullable(); // Format: auth:provider:id
    table.string('email', 255);
    table.string('name', 255);
    table.string('provider', 50).notNullable(); // 'github' or 'google'
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.index('auth_id');
    table.index('email');
  });

  // Pod table - represents subdomains (e.g., alice.webpods.org)
  await knex.schema.createTable('pod', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('pod_id', 63).unique().notNullable(); // DNS subdomain limit
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.index('pod_id');
  });

  // Stream table - represents streams within pods (supports nested paths)
  await knex.schema.createTable('stream', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('pod_id').references('id').inTable('pod').onDelete('CASCADE');
    table.string('stream_id', 256).notNullable(); // Stream path (can include slashes)
    table.uuid('creator_id').references('id').inTable('user').onDelete('RESTRICT');
    table.string('read_permission', 500).defaultTo('public');
    table.string('write_permission', 500).defaultTo('public');
    table.string('stream_type', 50).defaultTo('normal'); // 'normal', 'system', 'permission'
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['pod_id', 'stream_id']);
    table.index(['pod_id', 'stream_id']);
    table.index('creator_id');
    table.index('stream_type');
  });

  // Record table - append-only records with hash chain
  await knex.schema.createTable('record', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('stream_id').references('id').inTable('stream').onDelete('CASCADE');
    table.integer('sequence_num').notNullable();
    table.text('content'); // Can be text or JSON
    table.string('content_type', 100).defaultTo('text/plain');
    table.string('alias', 256); // Optional alias (any string allowed)
    table.string('hash', 100).notNullable(); // SHA-256 hash with prefix
    table.string('previous_hash', 100); // NULL for first record
    table.string('author_id', 255).notNullable(); // auth:provider:id format
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    
    table.unique(['stream_id', 'sequence_num']);
    table.unique(['stream_id', 'alias']);
    table.index(['stream_id', 'sequence_num']);
    table.index(['stream_id', 'alias']);
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
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.index('domain');
    table.index('pod_id');
  });

  // Rate limiting
  await knex.schema.createTable('rate_limit', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('identifier', 255).notNullable(); // user_id or ip_address
    table.string('action', 50).notNullable(); // 'write', 'read', 'pod_create', 'stream_create'
    table.integer('count').defaultTo(0);
    table.timestamptz('window_start').notNullable();
    table.timestamptz('window_end').notNullable();
    
    table.unique(['identifier', 'action', 'window_start']);
    table.index(['identifier', 'action', 'window_end']);
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
  await knex.raw('DROP TRIGGER IF EXISTS update_user_updated_at ON "user"');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('rate_limit');
  await knex.schema.dropTableIfExists('custom_domain');
  await knex.schema.dropTableIfExists('record');
  await knex.schema.dropTableIfExists('stream');
  await knex.schema.dropTableIfExists('pod');
  await knex.schema.dropTableIfExists('user');
}