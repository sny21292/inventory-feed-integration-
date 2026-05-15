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
 * Main feed job: fetch inventory → generate per-recipient CSV → deliver via the
 * recipient's configured method (email or sftp) → log per-recipient outcome →
 * record run summary.
 *
 * Failures are isolated per recipient — if APG email fails, UTV Source SFTP
 * still runs, and vice versa.
 *
 * Optional `filterLabels` (array of recipient labels) lets a manual run target
 * a subset — used by the --recipient="<label>" CLI flag for staged testing.
 */
async function runFeed({ filterLabels = null } = {}) {
  console.log(`[${new Date().toISOString()}] Starting inventory feed...`);

  let recipients = getRecipients();

  if (filterLabels && filterLabels.length > 0) {
    const wanted = new Set(filterLabels.map((l) => l.toLowerCase()));
    recipients = recipients.filter((r) => wanted.has(r.label.toLowerCase()));
    console.log(`Filter applied: targeting ${recipients.length} recipient(s) — ${recipients.map((r) => r.label).join(', ') || '(none matched)'}`);
  }

  if (recipients.length === 0) {
    console.error('No recipients to send to. Check filter or add recipients from the dashboard.');
    return;
  }

  const runId = startFeedRun();

  try {
    // 1. Fetch inventory from Shopify (one fetch shared across all recipients)
    console.log('Fetching inventory from Shopify...');
    const variants = await fetchInventory();
    console.log(`Fetched ${variants.length} variants`);

    if (variants.length === 0) {
      throw new Error('No variants returned from Shopify. Check API token and scopes.');
    }

    // 2. Deliver to each recipient with isolated failure handling.
    //    CSV is generated per-recipient since each format owns its own shape/filename.
    let successCount = 0;
    let failCount = 0;
    let lastRowCount = 0;
    let lastSizeBytes = 0;

    for (const recipient of recipients) {
      const recipientLabel = recipient.label;
      const format = recipient.format || 'apg';
      let fileName;
      let buffer;
      let rowCount;
      let sizeBytes;
      try {
        ({ buffer, fileName, rowCount, sizeBytes } = generateCSV(variants, format));
        lastRowCount = rowCount;
        lastSizeBytes = sizeBytes;
        console.log(`Generated CSV for ${recipientLabel} [${format}]: ${fileName} (${rowCount} rows, ${sizeBytes} bytes)`);

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
        if (result.remotePath) {
          console.log(`✓ [${recipient.method}] ${recipientLabel} → ${result.remotePath} (${result.bytesUploaded} bytes)`);
        } else {
          console.log(`✓ [${recipient.method}] ${recipientLabel}`);
        }
      } catch (err) {
        failCount += 1;
        logSend({
          recipient: recipientLabel,
          method: recipient.method,
          filename: fileName || `[${format} failed before filename]`,
          rowCount: rowCount || 0,
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

    // 3. Log feed run summary
    let runStatus;
    if (failCount === 0) runStatus = 'success';
    else if (successCount === 0) runStatus = 'failed';
    else runStatus = 'partial';

    completeFeedRun(runId, {
      status: runStatus,
      recipientCount: recipients.length,
      skuCount: lastRowCount,
      csvSizeBytes: lastSizeBytes,
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
  // Optional: --recipient="Label" (repeatable) to restrict to specific recipients.
  // Useful for staged rollout — e.g. test a brand-new SFTP partner alone before
  // letting the daily cron send everyone.
  const filterLabels = process.argv
    .filter((a) => a.startsWith('--recipient='))
    .map((a) => a.slice('--recipient='.length).replace(/^"|"$/g, ''));
  if (filterLabels.length > 0) {
    console.log(`Manual run with --recipient filter: ${filterLabels.join(', ')}`);
  } else {
    console.log('Manual run triggered with --once flag');
  }
  runFeed({ filterLabels: filterLabels.length > 0 ? filterLabels : null }).then(() => {
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
