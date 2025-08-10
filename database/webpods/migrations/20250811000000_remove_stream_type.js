/**
 * Remove stream_type column
 * 
 * The stream_type field was redundant:
 * - System streams can be identified by name pattern (.meta/*)
 * - Permission streams don't need special marking
 * - Any stream can contain any type of content
 */

export async function up(knex) {
  await knex.schema.alterTable('stream', (table) => {
    table.dropColumn('stream_type');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('stream', (table) => {
    table.string('stream_type', 50).defaultTo('normal');
  });
  
  // Restore system stream types
  await knex('stream')
    .where('stream_id', 'like', '.meta/%')
    .update({ stream_type: 'system' });
}