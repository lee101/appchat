import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';

const { Pool } = pg;

const memory = {
  runs: [],
  ledger: []
};

let pool = null;

export async function initDb() {
  if (!config.databaseUrl) return { mode: 'memory' };
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: /sslmode=require/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appchat_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      model TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      response TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appchat_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_appchat_runs_user_created ON appchat_runs(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_appchat_ledger_user_created ON appchat_ledger(user_id, created_at DESC)');
  return { mode: 'postgres' };
}

export async function closeDb() {
  if (pool) await pool.end();
}

export async function saveRun({ userId = 'anonymous', model, sector = '', prompt = '', response = '', tokens = 0 }) {
  const row = { id: randomUUID(), userId, model, sector, prompt, response, tokens, createdAt: new Date().toISOString() };
  if (!pool) {
    memory.runs.unshift(row);
    memory.runs = memory.runs.slice(0, 80);
    return row;
  }
  await pool.query(
    `INSERT INTO appchat_runs (id, user_id, model, sector, prompt, response, tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.id, userId, model, sector, prompt, response, tokens]
  );
  return row;
}

export async function listRuns(userId = 'anonymous') {
  if (!pool) return memory.runs.filter((r) => r.userId === userId || userId === 'anonymous').slice(0, 30);
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", model, sector, prompt, response, tokens, created_at AS "createdAt"
     FROM appchat_runs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [userId]
  );
  return rows;
}

export async function addLedger({ userId = 'anonymous', kind, amount, reference = '', signature = '' }) {
  const row = { id: randomUUID(), userId, kind, amount, reference, signature, createdAt: new Date().toISOString() };
  if (!pool) {
    memory.ledger.unshift(row);
    memory.ledger = memory.ledger.slice(0, 100);
    return row;
  }
  await pool.query(
    `INSERT INTO appchat_ledger (id, user_id, kind, amount, reference, signature)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.id, userId, kind, amount, reference, signature]
  );
  return row;
}

export async function ledgerForUser(userId = 'anonymous') {
  if (!pool) return memory.ledger.filter((r) => r.userId === userId || userId === 'anonymous').slice(0, 50);
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", kind, amount, reference, signature, created_at AS "createdAt"
     FROM appchat_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return rows;
}
