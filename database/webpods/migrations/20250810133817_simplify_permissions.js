/**
 * Simplify permissions from separate read/write to single access permission
 */

export async function up(knex) {
  // Add new access_permission column
  await knex.schema.alterTable('stream', (table) => {
    table.string('access_permission', 500).defaultTo('public');
  });
  
  // Migrate existing permissions
  // If read and write are the same, use that value
  // Otherwise, use the more restrictive one (private > permission > public)
  await knex.raw(`
    UPDATE stream 
    SET access_permission = 
      CASE 
        WHEN read_permission = write_permission THEN read_permission
        WHEN read_permission = 'private' OR write_permission = 'private' THEN 'private'
        WHEN read_permission LIKE '/%' OR write_permission LIKE '/%' THEN COALESCE(
          NULLIF(read_permission, 'public'),
          NULLIF(write_permission, 'public'),
          'public'
        )
        ELSE 'public'
      END
  `);
  
  // Drop old columns
  await knex.schema.alterTable('stream', (table) => {
    table.dropColumn('read_permission');
    table.dropColumn('write_permission');
  });
}

export async function down(knex) {
  // Add back the old columns
  await knex.schema.alterTable('stream', (table) => {
    table.string('read_permission', 500).defaultTo('public');
    table.string('write_permission', 500).defaultTo('public');
  });
  
  // Migrate back
  await knex.raw(`
    UPDATE stream 
    SET read_permission = access_permission,
        write_permission = access_permission
  `);
  
  // Drop new column
  await knex.schema.alterTable('stream', (table) => {
    table.dropColumn('access_permission');
  });
}