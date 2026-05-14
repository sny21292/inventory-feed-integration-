const { buildApgCsv } = require('./apg');
const { buildQuadratecCsv } = require('./quadratec');

/**
 * Dispatch CSV generation by recipient format.
 * Each format owns its own headers, row shape, and filename convention.
 */
function generateCSV(variants, format = 'apg') {
  switch (format) {
    case 'apg':
      return buildApgCsv(variants);
    case 'quadratec':
      return buildQuadratecCsv(variants);
    default:
      throw new Error(`Unknown CSV format: ${format}`);
  }
}

module.exports = { generateCSV };
