const { Readable } = require('stream');
const ftp = require('basic-ftp');

const CONNECT_TIMEOUT_MS = 20000;

/**
 * Build the remote filename from a recipient's filename_template.
 * Supports the {date} placeholder (YYYY-MM-DD); returns the template as-is when no placeholder is present.
 */
function buildRemoteFilename(template, fallbackName) {
  if (!template) return fallbackName;
  const date = new Date().toISOString().split('T')[0];
  return template.replace(/\{date\}/g, date);
}

function joinRemotePath(dir, filename) {
  const safeDir = (dir || '/').replace(/\/+$/, '');
  return `${safeDir}/${filename}`;
}

/**
 * Upload the CSV to a recipient's FTPS destination.
 * Recipient shape (zod-validated upstream):
 *   { method: 'ftps', label, host, port, username, password, remote_dir, filename_template }
 *
 * Uses explicit FTPS (control channel upgrades to TLS via AUTH SSL). The vendors we connect
 * to (Turn 5, Meyer Distributing) use self-signed certificates — `rejectUnauthorized: false`
 * is required to complete the handshake. The credentials are still authenticated normally.
 *
 * Returns { success, recipient, method, bytesUploaded, remotePath }.
 * Throws with a context-rich error on failure.
 */
async function uploadFtps(recipient, csvBuffer, csvFilename) {
  if (recipient.method !== 'ftps') {
    throw new Error(`uploadFtps called with non-ftps recipient (method=${recipient.method})`);
  }

  const client = new ftp.Client(CONNECT_TIMEOUT_MS);
  const remoteFilename = buildRemoteFilename(recipient.filename_template, csvFilename);
  const remotePath = joinRemotePath(recipient.remote_dir, remoteFilename);

  try {
    await client.access({
      host: recipient.host,
      port: recipient.port,
      user: recipient.username,
      password: recipient.password,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    });

    const remoteDir = recipient.remote_dir || '/';
    if (remoteDir !== '/' && remoteDir !== '.') {
      try {
        await client.cd(remoteDir);
      } catch (cdErr) {
        throw new Error(
          `Cannot enter remote directory "${remoteDir}" on ${recipient.host}: ${cdErr.message}. ` +
          `Confirm the path with the recipient or run scripts/test-ftps.js to discover it.`,
        );
      }
    }

    const stream = Readable.from(csvBuffer);
    await client.uploadFrom(stream, remoteFilename);

    return {
      success: true,
      recipient: recipient.label,
      method: 'ftps',
      bytesUploaded: csvBuffer.length,
      remotePath,
    };
  } catch (err) {
    const e = new Error(
      `FTPS delivery failed for ${recipient.label} (${recipient.username}@${recipient.host}:${recipient.port}${remotePath}): ${err.message}`,
    );
    e.cause = err;
    e.recipientLabel = recipient.label;
    e.host = recipient.host;
    e.remotePath = remotePath;
    throw e;
  } finally {
    client.close();
  }
}

module.exports = { uploadFtps, buildRemoteFilename, joinRemotePath };
