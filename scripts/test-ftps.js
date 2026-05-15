#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone FTPS connectivity test.
 *
 * Usage:
 *   node scripts/test-ftps.js <recipient-label>
 *
 * Connects with the credentials stored for the given FTPS recipient,
 * lists the remote directory, uploads a small test file, deletes it,
 * and prints ✓/✗ for each step. Use this to verify creds + figure out
 * the right `remote_dir` value before going live.
 */

require('dotenv').config();
const path = require('path');
const { Readable } = require('stream');
const ftp = require('basic-ftp');
const { getAllRecipientsRaw } = require(path.join(__dirname, '..', 'src', 'db'));

const CONNECT_TIMEOUT_MS = 20000;

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
    console.error('Usage: node scripts/test-ftps.js <recipient-label>');
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

  if (recipient.method !== 'ftps') {
    console.error(`Recipient "${label}" is method=${recipient.method}, not ftps. Aborting.`);
    process.exit(1);
  }

  console.log(`Testing FTPS recipient "${label}":`);
  console.log(`  host:     ${recipient.host}:${recipient.port}`);
  console.log(`  user:     ${recipient.username}`);
  console.log(`  dir:      ${recipient.remote_dir}`);
  console.log(`  template: ${recipient.filename_template}`);
  console.log('');

  const client = new ftp.Client(CONNECT_TIMEOUT_MS);
  let connected = false;
  let testRemotePath = null;

  try {
    await client.access({
      host: recipient.host,
      port: recipient.port,
      user: recipient.username,
      password: recipient.password,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    });
    connected = true;
    check(true, 'Connected');

    // 1. pwd
    try {
      const pwd = await client.pwd();
      check(true, 'pwd', pwd);
    } catch (err) {
      check(false, 'pwd', err.message);
    }

    // 2. Optionally enter remote_dir
    const dirToList = recipient.remote_dir || '/';
    if (dirToList !== '/' && dirToList !== '.') {
      try {
        await client.cd(dirToList);
        check(true, `cd ${dirToList}`);
      } catch (err) {
        check(false, `cd ${dirToList}`, err.message);
      }
    }

    // 3. List
    try {
      const entries = await client.list();
      check(true, `list ${dirToList}`, `${entries.length} entries`);
      const preview = entries.slice(0, 10).map((e) => `${e.isDirectory ? '[DIR]' : '     '} ${e.name}`);
      for (const line of preview) console.log(`        ${line}`);
      if (entries.length > 10) console.log(`        ... and ${entries.length - 10} more`);
    } catch (err) {
      check(false, `list ${dirToList}`, err.message);
    }

    // 4. Upload tiny test file
    const ts = Date.now();
    const testName = `ftps-connection-test-${ts}.txt`;
    const testBody = Buffer.from(`Turn Offroad FTPS probe ${new Date().toISOString()}\n`, 'utf-8');
    testRemotePath = testName; // we're already in the right dir from step 2

    try {
      await client.uploadFrom(Readable.from(testBody), testName);
      check(true, 'put test file', testName);
    } catch (err) {
      check(false, 'put test file', err.message);
      testRemotePath = null;
    }

    // 5. Delete test file
    if (testRemotePath) {
      try {
        await client.remove(testName);
        check(true, 'delete test file');
        testRemotePath = null;
      } catch (err) {
        check(false, 'delete test file', err.message);
      }
    }

    console.log('');
    console.log('FTPS probe complete.');
  } catch (err) {
    if (!connected) {
      check(false, 'Connect', err.message);
    } else {
      console.error('Unexpected error:', err.message);
    }
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
