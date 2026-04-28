const { stringify } = require('csv-stringify/sync');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

/**
 * Generate CSV file from inventory data in APG template format
 * Returns { filePath, fileName, rowCount }
 */
function generateCSV(variants) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const fileName = `turnoffroad-inventory-${today}.csv`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const headers = [
    'Part Number',
    'Brand',
    'Total Quantity',
    'Riverside Warehouse',
    'TOR Production',
  ];

  const rows = variants.map((v) => [
    v.partNumber,
    v.brand,
    v.totalQuantity,
    v.riversideWarehouse,
    v.torProduction,
  ]);

  const csvContent = stringify([headers, ...rows]);
  fs.writeFileSync(filePath, csvContent);

  return { filePath, fileName, rowCount: variants.length };
}

/**
 * Clean up CSV files older than 30 days
 */
function cleanupOldCSVs(daysToKeep = 30) {
  if (!fs.existsSync(OUTPUT_DIR)) return 0;

  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(OUTPUT_DIR);
  let deleted = 0;

  for (const file of files) {
    if (!file.endsWith('.csv')) continue;
    const filePath = path.join(OUTPUT_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  return deleted;
}

module.exports = { generateCSV, cleanupOldCSVs };
