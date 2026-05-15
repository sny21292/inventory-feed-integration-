const { sendEmail, sendAlertEmail } = require('./email');
const { uploadSftp } = require('./sftp');
const { uploadFtps } = require('./ftps');

/**
 * Deliver the CSV to a single recipient using its configured method.
 * The runner doesn't care about email vs sftp vs ftps — only this dispatcher does.
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
    case 'ftps':
      return uploadFtps(recipient, csvBuffer, csvFilename);
    default:
      throw new Error(`Unknown delivery method: ${recipient.method}`);
  }
}

module.exports = { deliver, sendAlertEmail };
