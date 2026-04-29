const cron = require('node-cron');
const fs = require('fs');
const config = require('./config');
const { fetchInventory } = require('./shopify');
const { generateCSV, cleanupOldCSVs } = require('./csv');
const { sendFeedEmail, sendAlertEmail } = require('./mailer');
const { logSend, startFeedRun, completeFeedRun, getRecipients, seedRecipientsFromEnv } = require('./db');
const { startServer, setRunFeedFn } = require('./server');

// Seed recipients from .env on first run
seedRecipientsFromEnv(config.recipients);

/**
 * Main feed job: fetch inventory → generate CSV → email to all recipients → log results
 */
async function runFeed() {
  console.log(`[${new Date().toISOString()}] Starting inventory feed...`);

  // Get recipients from SQLite (not .env)
  const recipients = getRecipients().map(r => r.email);

  if (recipients.length === 0) {
    console.error('No recipients configured. Add recipients from the dashboard.');
    return;
  }

  const runId = startFeedRun();

  try {
    // 1. Fetch inventory from Shopify
    console.log('Fetching inventory from Shopify...');
    const variants = await fetchInventory();
    console.log(`Fetched ${variants.length} variants`);

    if (variants.length === 0) {
      throw new Error('No variants returned from Shopify. Check API token and scopes.');
    }

    // 2. Generate CSV
    const { filePath, fileName, rowCount } = generateCSV(variants);
    const csvSize = fs.statSync(filePath).size;
    console.log(`Generated CSV: ${fileName} (${rowCount} rows, ${csvSize} bytes)`);

    // 3. Send to all recipients
    let failCount = 0;
    for (const recipient of recipients) {
      try {
        await sendFeedEmail(recipient, filePath, fileName, rowCount);
        logSend({ recipient, filename: fileName, rowCount, status: 'success' });
        console.log(`Sent to ${recipient}`);
      } catch (err) {
        failCount++;
        logSend({ recipient, filename: fileName, rowCount, status: 'failed', error: err.message });
        console.error(`Failed to send to ${recipient}:`, err.message);
        await sendAlertEmail(`Failed to send to ${recipient}: ${err.message}`);
      }
    }

    // 4. Cleanup old CSVs
    const deleted = cleanupOldCSVs(30);
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old CSV files`);
    }

    // 5. Log feed run
    completeFeedRun(runId, {
      status: failCount === 0 ? 'success' : 'partial',
      recipientCount: recipients.length,
      skuCount: rowCount,
      csvSizeBytes: csvSize,
    });

    console.log(`[${new Date().toISOString()}] Feed complete.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Feed failed:`, err.message);

    completeFeedRun(runId, {
      status: 'failed',
      errorMessage: err.message,
    });

    try {
      await sendAlertEmail(err.message);
    } catch (alertErr) {
      console.error('Failed to send alert:', alertErr.message);
    }
  }
}

// Start Express server (for dashboard + OAuth callback)
startServer();

// Wire up the run-now endpoint
setRunFeedFn(runFeed);

// Check for --once flag (manual run)
if (process.argv.includes('--once')) {
  console.log('Manual run triggered with --once flag');
  runFeed().then(() => {
    console.log('Manual run complete.');
  });
} else {
  // Schedule daily cron
  if (cron.validate(config.cronSchedule)) {
    cron.schedule(
      config.cronSchedule,
      () => {
        runFeed();
      },
      { timezone: config.timezone }
    );
    console.log(`Cron scheduled: ${config.cronSchedule} (${config.timezone})`);
  } else {
    console.error(`Invalid cron schedule: ${config.cronSchedule}`);
  }
}
