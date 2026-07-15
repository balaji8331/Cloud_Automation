import { Pool } from 'pg';

let guacamolePool: Pool | null = null;

export function getGuacamoleClient(): Pool {
  if (!guacamolePool) {
    guacamolePool = new Pool({
      host: process.env.GUACAMOLE_DB_HOST || '127.0.0.1',
      port: Number(process.env.GUACAMOLE_DB_PORT) || 5433,
      database: process.env.GUACAMOLE_DB_NAME || 'guacamole_db',
      user: process.env.GUACAMOLE_DB_USER || 'guacamole_user',
      password: process.env.GUACAMOLE_DB_PASSWORD || 'guacamole_user',
      connectionTimeoutMillis: 5000,
    });
  }
  return guacamolePool;
}
