const { stringify } = require('csv-stringify/sync');

const HEADERS = [
  'Part Number',
  'Brand',
  'Total Quantity',
  'Riverside Warehouse',
  'TOR Production',
];

/**
 * Generate CSV in APG format and return it as a Buffer.
 * Returns { buffer, fileName, rowCount, sizeBytes }.
 *
 * fileName is the canonical/default filename (used for the email attachment
 * and as the SFTP fallback when a recipient has no filename_template).
 */
function generateCSV(variants) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const fileName = `turnoffroad-inventory-${today}.csv`;

  const rows = variants.map((v) => [
    v.partNumber,
    v.brand,
    v.totalQuantity,
    v.riversideWarehouse,
    v.torProduction,
  ]);

  const csvContent = stringify([HEADERS, ...rows]);
  const buffer = Buffer.from(csvContent, 'utf-8');

  return {
    buffer,
    fileName,
    rowCount: variants.length,
    sizeBytes: buffer.length,
  };
}

module.exports = { generateCSV };
