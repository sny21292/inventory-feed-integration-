const cron = require('node-cron');
const config = require('./config');
const { fetchInventory } = require('./shopify');
const { generateCSV, cleanupOldCSVs } = require('./csv');
const { sendFeedEmail, sendAlertEmail } = require('./mailer');
const { logSend } = require('./db');
const { startServer } = require('./server');

/**
 * Main feed job: fetch inventory → generate CSV → email to all recipients → log results
 */
async function runFeed() {
  console.log(`[${new Date().toISOString()}] Starting inventory feed...`);

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
    console.log(`Generated CSV: ${fileName} (${rowCount} rows)`);

    // 3. Send to all recipients
    for (const recipient of config.recipients) {
      try {
        await sendFeedEmail(recipient, filePath, fileName, rowCount);
        logSend({ recipient, filename: fileName, rowCount, status: 'success' });
        console.log(`Sent to ${recipient}`);
      } catch (err) {
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

    console.log(`[${new Date().toISOString()}] Feed complete.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Feed failed:`, err.message);
    try {
      await sendAlertEmail(err.message);
    } catch (alertErr) {
      console.error('Failed to send alert:', alertErr.message);
    }
  }
}

// Start Express server (for dashboard + OAuth callback)
startServer();

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
