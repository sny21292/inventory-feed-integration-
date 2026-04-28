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

module.exports = { logSend, getRecentSends, getLastSuccess };
