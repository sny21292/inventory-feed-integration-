const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      recipient TEXT NOT NULL,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
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

/**
 * Log a send attempt
 */
function logSend({ recipient, filename, rowCount, status, error }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO send_log (recipient, filename, row_count, status, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(recipient, filename, rowCount, status, error || null);
}

/**
 * Start a feed run (returns the run ID)
 */
function startFeedRun() {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO feed_runs (started_at, status) VALUES (datetime('now'), 'running')
  `).run();
  return result.lastInsertRowid;
}

/**
 * Complete a feed run
 */
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
  `).run(status, recipientCount || null, skuCount || null, csvSizeBytes || null, errorMessage || null, runId);
}

/**
 * Get recent feed runs
 */
function getRecentRuns(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM feed_runs ORDER BY id DESC LIMIT ?
  `).all(limit);
}

/**
 * Get last successful feed run
 */
function getLastSuccessfulRun() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM feed_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1
  `).get();
}

/**
 * Get recent send history
 */
function getRecentSends(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM send_log ORDER BY id DESC LIMIT ?
  `).all(limit);
}

/**
 * Get last successful send
 */
function getLastSuccess() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM send_log WHERE status = 'success' ORDER BY id DESC LIMIT 1
  `).get();
}

/**
 * Get all active recipients
 */
function getRecipients() {
  const db = getDb();
  return db.prepare('SELECT * FROM recipients WHERE active = 1 ORDER BY added_at').all();
}

/**
 * Add a recipient
 */
function addRecipient(email) {
  const db = getDb();
  // Try to reactivate if previously removed
  const existing = db.prepare('SELECT * FROM recipients WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE recipients SET active = 1 WHERE email = ?').run(email);
    return existing.id;
  }
  const result = db.prepare('INSERT INTO recipients (email) VALUES (?)').run(email);
  return result.lastInsertRowid;
}

/**
 * Remove a recipient (soft delete)
 */
function removeRecipient(id) {
  const db = getDb();
  db.prepare('UPDATE recipients SET active = 0 WHERE id = ?').run(id);
}

/**
 * Seed recipients from .env (one-time, on first run)
 */
function seedRecipientsFromEnv(envRecipients) {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM recipients').get().c;
  if (count === 0 && envRecipients.length > 0) {
    for (const email of envRecipients) {
      db.prepare('INSERT OR IGNORE INTO recipients (email) VALUES (?)').run(email.trim());
    }
  }
}

module.exports = {
  logSend,
  getRecentSends,
  getLastSuccess,
  startFeedRun,
  completeFeedRun,
  getRecentRuns,
  getLastSuccessfulRun,
  getRecipients,
  addRecipient,
  removeRecipient,
  seedRecipientsFromEnv,
};
