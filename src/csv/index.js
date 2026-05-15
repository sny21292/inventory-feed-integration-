const { buildApgCsv } = require('./apg');
const { buildQuadratecCsv } = require('./quadratec');
const { buildTurn5Csv } = require('./turn5');
const { buildMeyerCsv } = require('./meyer');

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
    case 'turn5':
      return buildTurn5Csv(variants);
    case 'meyer':
      return buildMeyerCsv(variants);
    default:
      throw new Error(`Unknown CSV format: ${format}`);
  }
}

module.exports = { generateCSV };
