#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone SFTP connectivity test.
 *
 * Usage:
 *   node scripts/test-sftp.js <recipient-label>
 *
 * Connects with the credentials stored for the given SFTP recipient,
 * lists the remote directory, uploads a small test file, deletes it,
 * and prints ✓/✗ for each step. Use this to verify creds + figure out
 * the right `remote_dir` value before going live.
 */

require('dotenv').config();
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const { getAllRecipientsRaw } = require(path.join(__dirname, '..', 'src', 'db'));

const READY_TIMEOUT_MS = 20000;

function check(ok, msg, extra) {
  if (ok) {
    console.log(`  ✓ ${msg}${extra ? ` (${extra})` : ''}`);
  } else {
    console.error(`  ✗ ${msg}${extra ? ` (${extra})` : ''}`);
  }
}

async function main() {
  const label = process.argv[2];
  if (!label) {
    console.error('Usage: node scripts/test-sftp.js <recipient-label>');
    process.exit(1);
  }

  const recipients = getAllRecipientsRaw();
  const recipient = recipients.find((r) => r.label === label);

  if (!recipient) {
    console.error(`No recipient found with label "${label}".`);
    console.error('Available labels:');
    for (const r of recipients) {
      console.error(`  - ${r.label} (${r.method})`);
    }
    process.exit(1);
  }

  if (recipient.method !== 'sftp') {
    console.error(`Recipient "${label}" is method=${recipient.method}, not sftp. Aborting.`);
    process.exit(1);
  }

  console.log(`Testing SFTP recipient "${label}":`);
  console.log(`  host:     ${recipient.host}:${recipient.port}`);
  console.log(`  user:     ${recipient.username}`);
  console.log(`  dir:      ${recipient.remote_dir}`);
  console.log(`  template: ${recipient.filename_template}`);
  console.log('');

  const sftp = new SftpClient(`test-${label}`);
  let connected = false;
  let testRemotePath = null;

  try {
    await sftp.connect({
      host: recipient.host,
      port: recipient.port,
      username: recipient.username,
      password: recipient.password,
      readyTimeout: READY_TIMEOUT_MS,
    });
    connected = true;
    check(true, 'Connected');

    // 1. pwd
    let pwd = null;
    try {
      pwd = await sftp.cwd();
      check(true, 'pwd', pwd);
    } catch (err) {
      check(false, 'pwd', err.message);
    }

    // 2. List configured remote_dir
    const dirToList = recipient.remote_dir || '/';
    try {
      const entries = await sftp.list(dirToList);
      check(true, `list ${dirToList}`, `${entries.length} entries`);
      const preview = entries.slice(0, 10).map((e) => `${e.type === 'd' ? '[DIR]' : '     '} ${e.name}`);
      for (const line of preview) console.log(`        ${line}`);
      if (entries.length > 10) console.log(`        ... and ${entries.length - 10} more`);
    } catch (err) {
      check(false, `list ${dirToList}`, err.message);
    }

    // 3. Upload tiny test file
    const ts = Date.now();
    const testName = `sftp-connection-test-${ts}.txt`;
    testRemotePath = `${(recipient.remote_dir || '/').replace(/\/+$/, '')}/${testName}`;
    const testBody = Buffer.from(`Turn Offroad SFTP probe ${new Date().toISOString()}\n`, 'utf-8');

    try {
      await sftp.put(testBody, testRemotePath);
      check(true, 'put test file', testRemotePath);
    } catch (err) {
      check(false, 'put test file', err.message);
      testRemotePath = null;
    }

    // 4. Verify it exists
    if (testRemotePath) {
      try {
        const exists = await sftp.exists(testRemotePath);
        check(Boolean(exists), 'exists check', exists ? 'found' : 'missing');
      } catch (err) {
        check(false, 'exists check', err.message);
      }
    }

    // 5. Delete test file
    if (testRemotePath) {
      try {
        await sftp.delete(testRemotePath);
        check(true, 'delete test file');
        testRemotePath = null;
      } catch (err) {
        check(false, 'delete test file', err.message);
      }
    }

    console.log('');
    console.log('SFTP probe complete.');
  } catch (err) {
    if (!connected) {
      check(false, 'Connect', err.message);
    } else {
      console.error('Unexpected error:', err.message);
    }
    process.exitCode = 1;
  } finally {
    try {
      await sftp.end();
    } catch (_) {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
