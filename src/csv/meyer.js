const { buildSkuQtyCsv } = require('./_sku-qty');

function buildMeyerCsv(variants) {
  const today = new Date().toISOString().split('T')[0];
  return buildSkuQtyCsv(variants, {
    headers: ['Supplier SKU', 'Quantity'],
    fileName: `turnoffroad-inventory-${today}.csv`,
  });
}

module.exports = { buildMeyerCsv };
