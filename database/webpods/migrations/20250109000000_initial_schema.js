/**
 * Initial schema for WebPods
 * Creates user, queue, record, and rate_limit tables
 */

export async function up(knex) {
  // User table (singular)
  await knex.schema.createTable('user', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('auth_id', 255).unique().notNullable(); // auth:provider:id format
    table.string('email', 255);
    table.string('name', 255);
    table.string('provider', 50).notNullable();
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.index('auth_id');
    table.index('email');
  });

  // Queue table (singular)
  await knex.schema.createTable('queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('q_id', 256).unique().notNullable();
    table.uuid('creator_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('read_permission', 500).defaultTo('public');
    table.string('write_permission', 500).defaultTo('public');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    table.timestamptz('updated_at').defaultTo(knex.fn.now());
    
    table.index('q_id');
    table.index('creator_id');
  });

  // Record table (singular, append-only)
  await knex.schema.createTable('record', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('queue_id').references('id').inTable('queue').onDelete('CASCADE');
    table.integer('sequence_num').notNullable();
    table.jsonb('content').notNullable();
    table.string('content_type', 100).defaultTo('application/json');
    table.jsonb('metadata').defaultTo('{}'); // For X-* headers
    table.uuid('created_by').references('id').inTable('user');
    table.timestamptz('created_at').defaultTo(knex.fn.now());
    
    table.unique(['queue_id', 'sequence_num']);
    table.index(['queue_id', 'sequence_num']);
    table.index('created_by');
  });

  // Rate limit tracking table (singular)
  await knex.schema.createTable('rate_limit', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('user').onDelete('CASCADE');
    table.string('action', 50).notNullable(); // 'write' or 'read'
    table.integer('count').defaultTo(0);
    table.timestamptz('window_start').notNullable();
    table.timestamptz('window_end').notNullable();
    
    table.unique(['user_id', 'action', 'window_start']);
    table.index(['user_id', 'action', 'window_end']);
  });

  // Trigger to update updated_at on user
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
    CREATE TRIGGER update_queue_updated_at BEFORE UPDATE ON queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS update_queue_updated_at ON queue');
  await knex.raw('DROP TRIGGER IF EXISTS update_user_updated_at ON "user"');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column');
  
  await knex.schema.dropTableIfExists('rate_limit');
  await knex.schema.dropTableIfExists('record');
  await knex.schema.dropTableIfExists('queue');
  await knex.schema.dropTableIfExists('user');
}