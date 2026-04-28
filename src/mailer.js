const { Resend } = require('resend');
const fs = require('fs');
const config = require('./config');

const resend = new Resend(config.resendApiKey);

/**
 * Send CSV as email attachment to a single recipient
 */
async function sendFeedEmail(recipient, filePath, fileName, rowCount) {
  const today = new Date().toISOString().split('T')[0];
  const subject = `${config.emailSubject} - ${today}`;

  const fileContent = fs.readFileSync(filePath);

  const { data, error } = await resend.emails.send({
    from: config.fromEmail,
    to: recipient,
    subject,
    text: `Attached is the daily inventory feed for Turn Offroad.\n\nDate: ${today}\nTotal SKUs: ${rowCount}\nWarehouses: Riverside Warehouse, TOR Production\n\nThis is an automated email.`,
    attachments: [
      {
        filename: fileName,
        content: fileContent.toString('base64'),
        contentType: 'text/csv',
      },
    ],
  });

  if (error) {
    throw new Error(`Resend error for ${recipient}: ${JSON.stringify(error)}`);
  }

  return data;
}

/**
 * Send alert email to admin on failure
 */
async function sendAlertEmail(errorMessage) {
  const { error } = await resend.emails.send({
    from: config.fromEmail,
    to: config.alertEmail,
    subject: 'ALERT: Inventory Feed Failed',
    text: `The daily inventory feed failed.\n\nError: ${errorMessage}\n\nTime: ${new Date().toISOString()}\n\nPlease check the server logs.`,
  });

  if (error) {
    console.error('Failed to send alert email:', error);
  }
}

module.exports = { sendFeedEmail, sendAlertEmail };
