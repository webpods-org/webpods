// Root knexfile for WebPods
export default {
  development: {
    client: "postgresql",
    connection: {
      host: process.env.WEBPODS_DB_HOST || "localhost",
      port: parseInt(process.env.WEBPODS_DB_PORT || "5432"),
      database: process.env.WEBPODS_DB_NAME || "webpodsdb",
      user: process.env.WEBPODS_DB_USER || "postgres",
      password: process.env.WEBPODS_DB_PASSWORD || "postgres",
    },
    migrations: {
      directory: "./database/webpods/migrations",
    },
  },
  test: {
    client: "postgresql",
    connection: {
      host: process.env.WEBPODS_DB_HOST || "localhost",
      port: parseInt(process.env.WEBPODS_DB_PORT || "5432"),
      database: process.env.WEBPODS_DB_NAME || "webpodsdb_test",
      user: process.env.WEBPODS_DB_USER || "postgres",
      password: process.env.WEBPODS_DB_PASSWORD || "postgres",
    },
    migrations: {
      directory: "./database/webpods/migrations",
    },
  },
  production: {
    client: "postgresql",
    connection: {
      host: process.env.WEBPODS_DB_HOST,
      port: parseInt(process.env.WEBPODS_DB_PORT || "5432"),
      database: process.env.WEBPODS_DB_NAME,
      user: process.env.WEBPODS_DB_USER,
      password: process.env.WEBPODS_DB_PASSWORD,
    },
    migrations: {
      directory: "./database/webpods/migrations",
    },
  },
};
