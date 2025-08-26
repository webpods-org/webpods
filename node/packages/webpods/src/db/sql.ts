/**
 * SQL helper functions for safer query generation
 * Following the same pattern as Foreman's SQL helpers
 */

/**
 * Generate an INSERT statement with named parameters
 *
 * @param tableName - The table to insert into
 * @param params - Object with snake_case column names as keys
 * @returns SQL INSERT statement string
 *
 * @example
 * const params = {
 *   pod_name: podName,
 *   name: streamId,
 *   user_id: userId,
 *   access_permission: 'public',
 *   created_at: new Date()
 * };
 * const query = `${sql.insert("stream", params)} RETURNING *`;
 */
export function insert(tableName: string, params: Record<string, any>): string {
  const columns = Object.keys(params);
  const values = columns.map((col) => `$(${col})`);

  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")})`;
}

/**
 * Generate an UPDATE statement with named parameters
 *
 * @param tableName - The table to update
 * @param params - Object with snake_case column names as keys
 * @returns SQL UPDATE statement string (without WHERE clause)
 *
 * @example
 * const updateParams = {
 *   status: 'completed',
 *   updated_at: new Date()
 * };
 * const query = `
 *   ${sql.update("task", updateParams)}
 *   WHERE id = $(taskId) AND org_id = $(orgId)
 *   RETURNING *
 * `;
 */
export function update(tableName: string, params: Record<string, any>): string {
  const setClause = Object.keys(params).map((col) => `${col} = $(${col})`);

  return `UPDATE ${tableName} SET ${setClause.join(", ")}`;
}
