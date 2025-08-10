/**
 * WebPods Initial Schema
 * 
 * Creates the complete database structure for WebPods:
 * - Pods (subdomains)
 * - Queues (append-only logs within pods)
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

  // Queue table - represents queues within pods
  await knex.schema.createTable('queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('pod_id').references('id').inTable('pod').onDelete('CASCADE');
    table.string('queue_id', 256).notNullable();
    table.uuid('creator_id').references('id').inTable('user').onDelete('RESTRICT');
    table.string('read_permission', 500).defaultTo('public');
    table.string('write_permission', 500).defaultTo('public');
    table.string('queue_type', 50).defaultTo('normal'); // 'normal', 'system', 'permission'
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['pod_id', 'queue_id']);
    table.index(['pod_id', 'queue_id']);
    table.index('creator_id');
    table.index('queue_type');
  });

  // Record table - append-only records with hash chain
  await knex.schema.createTable('record', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('queue_id').references('id').inTable('queue').onDelete('CASCADE');
    table.integer('sequence_num').notNullable();
    table.text('content'); // Can be text or JSON
    table.string('content_type', 100).defaultTo('text/plain');
    table.string('alias', 256); // Optional alias (must contain non-numeric character)
    table.string('hash', 64).notNullable(); // SHA-256 hash
    table.string('previous_hash', 64); // NULL for first record
    table.string('author_id', 255).notNullable(); // auth:provider:id format
    table.jsonb('metadata').defaultTo('{}'); // For X-* headers
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    
    table.unique(['queue_id', 'sequence_num']);
    table.index(['queue_id', 'sequence_num']);
    table.index(['queue_id', 'alias']);
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
    table.string('type', 50).notNullable(); // 'write', 'read', 'pod_create', 'queue_create'
    table.integer('count').defaultTo(0);
    table.timestamptz('window_start').notNullable();
    table.timestamptz('window_end').notNullable();
    
    table.unique(['key', 'action', 'window_start']);
    table.index(['key', 'action', 'window_end']);
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
    CREATE TRIGGER update_queue_updated_at BEFORE UPDATE ON queue
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
  await knex.raw('DROP TRIGGER IF EXISTS update_queue_updated_at ON queue');
  await knex.raw('DROP TRIGGER IF EXISTS update_pod_updated_at ON pod');
  await knex.raw('DROP TRIGGER IF EXISTS update_user_updated_at ON "user"');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('rate_limit');
  await knex.schema.dropTableIfExists('custom_domain');
  await knex.schema.dropTableIfExists('record');
  await knex.schema.dropTableIfExists('queue');
  await knex.schema.dropTableIfExists('pod');
  await knex.schema.dropTableIfExists('user');
}