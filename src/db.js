const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'feed.sqlite');

let db;

function getDb() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      recipient TEXT NOT NULL,
      method TEXT,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      bytes_uploaded INTEGER,
      status TEXT NOT NULL,
      error TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL DEFAULT 'email',
      email TEXT,
      host TEXT,
      port INTEGER,
      username TEXT,
      password TEXT,
      remote_dir TEXT,
      filename_template TEXT,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME NOT NULL,
      completed_at DATETIME,
      status TEXT NOT NULL,
      recipient_count INTEGER,
      sku_count INTEGER,
      csv_size_bytes INTEGER,
      error_message TEXT
    )
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Recipient validation (zod discriminated union)
// ---------------------------------------------------------------------------

const emailRecipientSchema = z.object({
  id: z.number().int(),
  label: z.string().min(1),
  method: z.literal('email'),
  email: z.string().email(),
  added_at: z.string(),
  active: z.number().int(),
});

const sftpRecipientSchema = z.object({
  id: z.number().int(),
  label: z.string().min(1),
  method: z.literal('sftp'),
  host: z.string().min(1),
  port: z.number().int().positive(),
  username: z.string().min(1),
  password: z.string().min(1),
  remote_dir: z.string().min(1),
  filename_template: z.string().min(1).refine(
    (v) => v.includes('{date}'),
    { message: "filename_template must include '{date}'" },
  ),
  added_at: z.string(),
  active: z.number().int(),
});

const recipientSchema = z.discriminatedUnion('method', [
  emailRecipientSchema,
  sftpRecipientSchema,
]);

function shapeRowForValidation(row) {
  const base = {
    id: row.id,
    label: row.label,
    method: row.method,
    added_at: row.added_at,
    active: row.active,
  };
  if (row.method === 'email') {
    return { ...base, email: row.email };
  }
  if (row.method === 'sftp') {
    return {
      ...base,
      host: row.host,
      port: row.port,
      username: row.username,
      password: row.password,
      remote_dir: row.remote_dir,
      filename_template: row.filename_template,
    };
  }
  return { ...base, _unknownMethod: row.method };
}

// ---------------------------------------------------------------------------
// Send log
// ---------------------------------------------------------------------------

function logSend({ recipient, method, filename, rowCount, bytesUploaded, status, error }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO send_log (recipient, method, filename, row_count, bytes_uploaded, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    recipient,
    method || null,
    filename,
    rowCount,
    typeof bytesUploaded === 'number' ? bytesUploaded : null,
    status,
    error || null,
  );
}

function getRecentSends(limit = 20) {
  const db = getDb();
  return db.prepare(`SELECT * FROM send_log ORDER BY id DESC LIMIT ?`).all(limit);
}

function getLastSuccess() {
  const db = getDb();
  return db.prepare(`SELECT * FROM send_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get();
}

// ---------------------------------------------------------------------------
// Feed run lifecycle
// ---------------------------------------------------------------------------

function startFeedRun() {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO feed_runs (started_at, status) VALUES (datetime('now'), 'running')
  `).run();
  return result.lastInsertRowid;
}

function completeFeedRun(runId, { status, recipientCount, skuCount, csvSizeBytes, errorMessage }) {
  const db = getDb();
  db.prepare(`
    UPDATE feed_runs
    SET completed_at = datetime('now'),
        status = ?,
        recipient_count = ?,
        sku_count = ?,
        csv_size_bytes = ?,
        error_message = ?
    WHERE id = ?
  `).run(
    status,
    recipientCount || null,
    skuCount || null,
    csvSizeBytes || null,
    errorMessage || null,
    runId,
  );
}

function getRecentRuns(limit = 50) {
  const db = getDb();
  return db.prepare(`SELECT * FROM feed_runs ORDER BY id DESC LIMIT ?`).all(limit);
}

function getLastSuccessfulRun() {
  const db = getDb();
  return db.prepare(`SELECT * FROM feed_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get();
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * Get all active recipients, validated.
 * Misconfigured rows are logged and skipped (not thrown) so one bad row
 * doesn't kill the entire feed run.
 */
function getRecipients() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM recipients WHERE active = 1 ORDER BY added_at').all();
  const valid = [];
  for (const row of rows) {
    const shaped = shapeRowForValidation(row);
    const result = recipientSchema.safeParse(shaped);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.error(
        `[db] recipient id=${row.id} label="${row.label}" method=${row.method} is misconfigured; skipping. Issues:`,
        result.error.issues,
      );
    }
  }
  return valid;
}

/** Raw read — returns ALL recipients (active + inactive), no validation. For dashboard listing. */
function getAllRecipientsRaw() {
  const db = getDb();
  return db.prepare('SELECT * FROM recipients ORDER BY added_at').all();
}

function getRecipientById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM recipients WHERE id = ?').get(id);
}

/**
 * Add a new recipient. `data` shape depends on method:
 *   { method: 'email', label, email }
 *   { method: 'sftp', label, host, port, username, password, remote_dir, filename_template }
 * Reactivates if a row with the same label already exists.
 */
function addRecipient(data) {
  const db = getDb();
  if (!data || !data.label || !data.method) {
    throw new Error('label and method are required');
  }

  const existing = db.prepare('SELECT id FROM recipients WHERE label = ?').get(data.label);
  if (existing) {
    updateRecipient(existing.id, data);
    db.prepare('UPDATE recipients SET active = 1 WHERE id = ?').run(existing.id);
    return existing.id;
  }

  if (data.method === 'email') {
    const result = db.prepare(`
      INSERT INTO recipients (label, method, email) VALUES (?, 'email', ?)
    `).run(data.label, data.email);
    return result.lastInsertRowid;
  }

  if (data.method === 'sftp') {
    const result = db.prepare(`
      INSERT INTO recipients
        (label, method, host, port, username, password, remote_dir, filename_template)
      VALUES (?, 'sftp', ?, ?, ?, ?, ?, ?)
    `).run(
      data.label,
      data.host,
      data.port,
      data.username,
      data.password,
      data.remote_dir,
      data.filename_template,
    );
    return result.lastInsertRowid;
  }

  throw new Error(`Unknown method: ${data.method}`);
}

/**
 * Update an existing recipient. Only provided fields are touched.
 * Method change is allowed (e.g. email → sftp).
 */
function updateRecipient(id, data) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM recipients WHERE id = ?').get(id);
  if (!current) throw new Error(`No recipient with id ${id}`);

  const next = {
    label: data.label ?? current.label,
    method: data.method ?? current.method,
    email: data.email ?? current.email,
    host: data.host ?? current.host,
    port: data.port ?? current.port,
    username: data.username ?? current.username,
    password: data.password ?? current.password,
    remote_dir: data.remote_dir ?? current.remote_dir,
    filename_template: data.filename_template ?? current.filename_template,
  };

  // If switching method, blank out the other method's fields to avoid stale values
  if (next.method === 'email') {
    next.host = null;
    next.port = null;
    next.username = null;
    next.password = null;
    next.remote_dir = null;
    next.filename_template = null;
  } else if (next.method === 'sftp') {
    next.email = null;
  }

  db.prepare(`
    UPDATE recipients SET
      label = ?,
      method = ?,
      email = ?,
      host = ?,
      port = ?,
      username = ?,
      password = ?,
      remote_dir = ?,
      filename_template = ?
    WHERE id = ?
  `).run(
    next.label,
    next.method,
    next.email,
    next.host,
    next.port,
    next.username,
    next.password,
    next.remote_dir,
    next.filename_template,
    id,
  );
}

/** Soft delete */
function removeRecipient(id) {
  const db = getDb();
  db.prepare('UPDATE recipients SET active = 0 WHERE id = ?').run(id);
}

module.exports = {
  // log
  logSend,
  getRecentSends,
  getLastSuccess,
  // run
  startFeedRun,
  completeFeedRun,
  getRecentRuns,
  getLastSuccessfulRun,
  // recipients
  getRecipients,
  getAllRecipientsRaw,
  getRecipientById,
  addRecipient,
  updateRecipient,
  removeRecipient,
  // schema (exposed for tests/scripts)
  recipientSchema,
};
