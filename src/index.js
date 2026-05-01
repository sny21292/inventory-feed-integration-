const cron = require('node-cron');
const config = require('./config');
const { fetchInventory } = require('./shopify');
const { generateCSV } = require('./csv');
const { deliver, sendAlertEmail } = require('./delivery');
const {
  logSend,
  startFeedRun,
  completeFeedRun,
  getRecipients,
} = require('./db');
const { startServer, setRunFeedFn } = require('./server');

/**
 * Main feed job: fetch inventory → generate CSV → deliver to all active
 * recipients via their configured method (email or sftp) → log per-recipient
 * outcome → record run summary.
 *
 * Failures are isolated per recipient — if APG email fails, UTV Source SFTP
 * still runs, and vice versa.
 */
async function runFeed() {
  console.log(`[${new Date().toISOString()}] Starting inventory feed...`);

  const recipients = getRecipients();

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

    // 2. Generate CSV (Buffer in memory — no disk write)
    const { buffer, fileName, rowCount, sizeBytes } = generateCSV(variants);
    console.log(`Generated CSV: ${fileName} (${rowCount} rows, ${sizeBytes} bytes)`);

    // 3. Deliver to each recipient with isolated failure handling
    let successCount = 0;
    let failCount = 0;

    for (const recipient of recipients) {
      const recipientLabel = recipient.label;
      try {
        const result = await deliver(recipient, buffer, fileName, rowCount);
        successCount += 1;
        logSend({
          recipient: recipientLabel,
          method: recipient.method,
          filename: fileName,
          rowCount,
          bytesUploaded: result.bytesUploaded,
          status: 'success',
        });
        if (recipient.method === 'sftp') {
          console.log(`✓ [${recipient.method}] ${recipientLabel} → ${result.remotePath} (${result.bytesUploaded} bytes)`);
        } else {
          console.log(`✓ [${recipient.method}] ${recipientLabel}`);
        }
      } catch (err) {
        failCount += 1;
        logSend({
          recipient: recipientLabel,
          method: recipient.method,
          filename: fileName,
          rowCount,
          status: 'failed',
          error: err.message,
        });
        console.error(`✗ [${recipient.method}] ${recipientLabel}:`, err.message);
        try {
          await sendAlertEmail(`Failed delivery to ${recipientLabel} (${recipient.method}): ${err.message}`);
        } catch (alertErr) {
          console.error('Failed to send alert email:', alertErr.message);
        }
      }
    }

    // 4. Log feed run summary
    let runStatus;
    if (failCount === 0) runStatus = 'success';
    else if (successCount === 0) runStatus = 'failed';
    else runStatus = 'partial';

    completeFeedRun(runId, {
      status: runStatus,
      recipientCount: recipients.length,
      skuCount: rowCount,
      csvSizeBytes: sizeBytes,
    });

    console.log(
      `[${new Date().toISOString()}] Feed complete: ${successCount}/${recipients.length} recipients succeeded.`,
    );
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

// Start Express server (dashboard + OAuth callback)
startServer();
setRunFeedFn(runFeed);

if (process.argv.includes('--once')) {
  console.log('Manual run triggered with --once flag');
  runFeed().then(() => {
    console.log('Manual run complete.');
  });
} else {
  if (cron.validate(config.cronSchedule)) {
    cron.schedule(
      config.cronSchedule,
      () => {
        runFeed();
      },
      { timezone: config.timezone },
    );
    console.log(`Cron scheduled: ${config.cronSchedule} (${config.timezone})`);
  } else {
    console.error(`Invalid cron schedule: ${config.cronSchedule}`);
  }
}
