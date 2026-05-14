const { stringify } = require('csv-stringify/sync');

const HEADERS = [
  'Part Number',
  'Brand',
  'Total Quantity',
  'Riverside Warehouse',
  'TOR Production',
];

/**
 * APG vendor-feed format. One row per variant, includes per-location quantities.
 * Returns { buffer, fileName, rowCount, sizeBytes }.
 */
function buildApgCsv(variants) {
  const today = new Date().toISOString().split('T')[0];
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

module.exports = { buildApgCsv };
