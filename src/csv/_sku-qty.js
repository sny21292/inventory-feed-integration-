const { stringify } = require('csv-stringify/sync');

/**
 * Shared 2-column SKU + Quantity CSV builder.
 *
 * Several distribution partners (Turn 5, Meyer Distributing) want the same
 * 2-column shape with only the header labels and filename differing. This
 * helper owns the data shape; each partner module wraps it with its specifics.
 *
 * Behavior:
 * - One row per variant (uses Shopify SKU as the identifier)
 * - Includes zero-stock items (partners want the full catalog)
 * - Clamps negatives to 0 (Shopify oversells can produce negative on-hand,
 *   which isn't a meaningful stock level for a dealer-facing feed)
 *
 * Options:
 * - headers: tuple of [skuHeader, qtyHeader]; pass null/false to omit the header row
 * - fileName: literal filename to embed in the returned envelope
 *
 * Returns { buffer, fileName, rowCount, sizeBytes }.
 */
function buildSkuQtyCsv(variants, { headers, fileName }) {
  const rows = variants.map((v) => [v.partNumber, Math.max(0, v.totalQuantity)]);
  const records = headers ? [headers, ...rows] : rows;

  const csvContent = stringify(records);
  const buffer = Buffer.from(csvContent, 'utf-8');

  return {
    buffer,
    fileName,
    rowCount: variants.length,
    sizeBytes: buffer.length,
  };
}

module.exports = { buildSkuQtyCsv };
