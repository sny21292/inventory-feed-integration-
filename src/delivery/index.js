const { sendEmail, sendAlertEmail } = require('./email');
const { uploadSftp } = require('./sftp');

/**
 * Deliver the CSV to a single recipient using its configured method.
 * The runner doesn't care about email vs sftp — only this dispatcher does.
 *
 * Returns { success, recipient, method, bytesUploaded, ...methodSpecific }.
 * Throws on failure (caller decides whether to keep going to other recipients).
 */
async function deliver(recipient, csvBuffer, csvFilename, rowCount) {
  switch (recipient.method) {
    case 'email':
      return sendEmail(recipient, csvBuffer, csvFilename, rowCount);
    case 'sftp':
      return uploadSftp(recipient, csvBuffer, csvFilename);
    default:
      throw new Error(`Unknown delivery method: ${recipient.method}`);
  }
}

module.exports = { deliver, sendAlertEmail };
