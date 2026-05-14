const { stringify } = require('csv-stringify/sync');

const HEADERS = ['MPN', 'Location', 'Inventory'];

const LOCATION_VALUE = 'warehouse';
const FILE_NAME = 'Inventory.csv';

/**
 * Quadratec vendor-feed format. Columns: MPN, Location, Inventory.
 * One row per variant with locations summed into a single "warehouse" row.
 * Zero-stock items are included intentionally (Quadratec requires the full catalog).
 * Negative quantities (from Shopify oversells) are clamped to 0 — a negative
 * count isn't meaningful as a stock level for a dealer-facing feed.
 * Returns { buffer, fileName, rowCount, sizeBytes }.
 */
function buildQuadratecCsv(variants) {
  const rows = variants.map((v) => [v.partNumber, LOCATION_VALUE, Math.max(0, v.totalQuantity)]);

  const csvContent = stringify([HEADERS, ...rows]);
  const buffer = Buffer.from(csvContent, 'utf-8');

  return {
    buffer,
    fileName: FILE_NAME,
    rowCount: variants.length,
    sizeBytes: buffer.length,
  };
}

module.exports = { buildQuadratecCsv };
