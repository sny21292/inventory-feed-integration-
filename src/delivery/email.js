const { Resend } = require('resend');
const config = require('../config');

const resend = new Resend(config.resendApiKey);

/**
 * Send the CSV as an email attachment to a single recipient.
 * Returns { success, recipient, method, bytesUploaded }.
 */
async function sendEmail(recipient, csvBuffer, csvFilename, rowCount) {
  const today = new Date().toISOString().split('T')[0];
  const subject = `${config.emailSubject} - ${today}`;

  const { data, error } = await resend.emails.send({
    from: config.fromEmail,
    to: recipient.email,
    subject,
    text: `Attached is the daily inventory feed for Turn Offroad.\n\nDate: ${today}\nTotal SKUs: ${rowCount}\nWarehouses: Riverside Warehouse, TOR Production\n\nThis is an automated email.`,
    attachments: [
      {
        filename: csvFilename,
        content: csvBuffer.toString('base64'),
        contentType: 'text/csv',
      },
    ],
  });

  if (error) {
    throw new Error(`Resend error for ${recipient.email}: ${JSON.stringify(error)}`);
  }

  return {
    success: true,
    recipient: recipient.email,
    method: 'email',
    bytesUploaded: csvBuffer.length,
    providerMessageId: data?.id ?? null,
  };
}

/**
 * Failure-alert email goes to ALERT_EMAIL.
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

module.exports = { sendEmail, sendAlertEmail };
