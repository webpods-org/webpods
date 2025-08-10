/**
 * Rename queue to stream throughout the database
 * 
 * Changes:
 * - Rename 'queue' table to 'stream'
 * - Rename 'queue_id' columns to 'stream_id'
 * - Rename 'queue_type' to 'stream_type'
 * - Update constraints and indexes
 */

export async function up(knex) {
  // 1. Drop foreign key constraints that reference queue table
  await knex.raw(`
    ALTER TABLE record 
    DROP CONSTRAINT record_queue_id_foreign
  `);

  // 2. Rename queue table to stream
  await knex.schema.renameTable('queue', 'stream');

  // 3. Rename columns in stream table
  await knex.schema.alterTable('stream', (table) => {
    table.renameColumn('queue_id', 'stream_id');
    table.renameColumn('queue_type', 'stream_type');
  });

  // 4. Rename queue_id to stream_id in record table
  await knex.schema.alterTable('record', (table) => {
    table.renameColumn('queue_id', 'stream_id');
  });

  // 5. Re-create foreign key constraint with new names
  await knex.schema.alterTable('record', (table) => {
    table.foreign('stream_id').references('id').inTable('stream').onDelete('CASCADE');
  });

  // 6. Update trigger name
  await knex.raw(`
    ALTER TRIGGER update_queue_updated_at ON stream 
    RENAME TO update_stream_updated_at
  `);

  // 7. Drop old indexes and create new ones with updated names
  await knex.raw(`
    -- Drop old unique constraint
    ALTER TABLE stream DROP CONSTRAINT queue_pod_id_queue_id_unique;
    
    -- Create new unique constraint
    ALTER TABLE stream ADD CONSTRAINT stream_pod_id_stream_id_unique 
    UNIQUE (pod_id, stream_id);
    
    -- Drop old unique constraint on record
    ALTER TABLE record DROP CONSTRAINT record_queue_id_sequence_num_unique;
    
    -- Create new unique constraint on record
    ALTER TABLE record ADD CONSTRAINT record_stream_id_sequence_num_unique 
    UNIQUE (stream_id, sequence_num);
  `);

  // 8. Fix rate_limit table constraints (had wrong column names in original migration)
  await knex.raw(`
    ALTER TABLE rate_limit DROP CONSTRAINT IF EXISTS rate_limit_key_action_window_start_unique;
  `);
  
  await knex.schema.alterTable('rate_limit', (table) => {
    table.renameColumn('type', 'action');
    table.unique(['identifier', 'action', 'window_start']);
    table.index(['identifier', 'action', 'window_end']);
  });
}

export async function down(knex) {
  // Reverse all changes
  
  // 1. Fix rate_limit table
  await knex.raw(`
    ALTER TABLE rate_limit DROP CONSTRAINT IF EXISTS rate_limit_identifier_action_window_start_unique;
  `);
  
  await knex.schema.alterTable('rate_limit', (table) => {
    table.renameColumn('action', 'type');
  });

  // 2. Drop foreign key constraints
  await knex.raw(`
    ALTER TABLE record 
    DROP CONSTRAINT record_stream_id_foreign
  `);

  // 3. Rename columns back
  await knex.schema.alterTable('record', (table) => {
    table.renameColumn('stream_id', 'queue_id');
  });

  await knex.schema.alterTable('stream', (table) => {
    table.renameColumn('stream_id', 'queue_id');
    table.renameColumn('stream_type', 'queue_type');
  });

  // 4. Rename table back
  await knex.schema.renameTable('stream', 'queue');

  // 5. Re-create foreign key constraint with old names
  await knex.schema.alterTable('record', (table) => {
    table.foreign('queue_id').references('id').inTable('queue').onDelete('CASCADE');
  });

  // 6. Update trigger name
  await knex.raw(`
    ALTER TRIGGER update_stream_updated_at ON queue 
    RENAME TO update_queue_updated_at
  `);

  // 7. Restore old constraints
  await knex.raw(`
    -- Drop new unique constraint
    ALTER TABLE queue DROP CONSTRAINT stream_pod_id_stream_id_unique;
    
    -- Create old unique constraint
    ALTER TABLE queue ADD CONSTRAINT queue_pod_id_queue_id_unique 
    UNIQUE (pod_id, queue_id);
    
    -- Drop new unique constraint on record
    ALTER TABLE record DROP CONSTRAINT record_stream_id_sequence_num_unique;
    
    -- Create old unique constraint on record
    ALTER TABLE record ADD CONSTRAINT record_queue_id_sequence_num_unique 
    UNIQUE (queue_id, sequence_num);
  `);
}