// Knexfile for WebPods database
export default {
  client: 'postgresql',
  connection: {
    host: process.env.WEBPODS_DB_HOST || 'localhost',
    port: parseInt(process.env.WEBPODS_DB_PORT || '5432'),
    database: process.env.WEBPODS_DB_NAME || 'webpodsdb',
    user: process.env.WEBPODS_DB_USER || 'postgres',
    password: process.env.WEBPODS_DB_PASSWORD || 'postgres'
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations'
  }
};