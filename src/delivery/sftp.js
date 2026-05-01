const path = require('path');
const SftpClient = require('ssh2-sftp-client');

const CONNECT_TIMEOUT_MS = 20000;
const READY_TIMEOUT_MS = 20000;

/**
 * Build the remote filename from a recipient's filename_template.
 * Currently only supports the {date} placeholder (YYYY-MM-DD).
 */
function buildRemoteFilename(template, fallbackName) {
  if (!template) return fallbackName;
  const date = new Date().toISOString().split('T')[0];
  return template.replace(/\{date\}/g, date);
}

/**
 * Join a remote_dir + filename into a single POSIX path.
 * Always uses forward slashes regardless of host OS.
 */
function joinRemotePath(dir, filename) {
  const safeDir = (dir || '/').replace(/\/+$/, ''); // trim trailing slashes
  return `${safeDir}/${filename}`;
}

/**
 * Upload the CSV to a recipient's SFTP destination.
 * Recipient shape (zod-validated upstream):
 *   { method: 'sftp', label, host, port, username, password, remote_dir, filename_template }
 *
 * Returns { success, recipient, method, bytesUploaded, remotePath }.
 * Throws with a context-rich error on failure.
 */
async function uploadSftp(recipient, csvBuffer, csvFilename) {
  if (recipient.method !== 'sftp') {
    throw new Error(`uploadSftp called with non-sftp recipient (method=${recipient.method})`);
  }

  const sftp = new SftpClient(`feed-${recipient.label}`);
  const remoteFilename = buildRemoteFilename(recipient.filename_template, csvFilename);
  const remotePath = joinRemotePath(recipient.remote_dir, remoteFilename);

  try {
    await sftp.connect({
      host: recipient.host,
      port: recipient.port,
      username: recipient.username,
      password: recipient.password,
      readyTimeout: READY_TIMEOUT_MS,
      timeout: CONNECT_TIMEOUT_MS,
    });

    // Verify remote dir exists. exists() returns the type ('d', '-', 'l') or false.
    const remoteDir = recipient.remote_dir || '/';
    if (remoteDir !== '/' && remoteDir !== '.') {
      const dirType = await sftp.exists(remoteDir);
      if (!dirType) {
        throw new Error(
          `Remote directory does not exist on ${recipient.host}: "${remoteDir}". ` +
          `Confirm with the recipient or run scripts/test-sftp.js to discover the correct path.`,
        );
      }
      if (dirType !== 'd') {
        throw new Error(`Remote path exists but is not a directory: "${remoteDir}" (type=${dirType})`);
      }
    }

    await sftp.put(csvBuffer, remotePath);

    return {
      success: true,
      recipient: recipient.label,
      method: 'sftp',
      bytesUploaded: csvBuffer.length,
      remotePath,
    };
  } catch (err) {
    // Re-throw with recipient context so the caller's error log is actionable.
    const e = new Error(
      `SFTP delivery failed for ${recipient.label} (${recipient.username}@${recipient.host}:${recipient.port}${remotePath}): ${err.message}`,
    );
    e.cause = err;
    e.recipientLabel = recipient.label;
    e.host = recipient.host;
    e.remotePath = remotePath;
    throw e;
  } finally {
    try {
      await sftp.end();
    } catch (endErr) {
      // Connection may already be closed; log but don't mask the original error.
      console.warn(`[sftp] non-fatal: failed to close ${recipient.label} session:`, endErr.message);
    }
  }
}

module.exports = { uploadSftp, buildRemoteFilename, joinRemotePath };
