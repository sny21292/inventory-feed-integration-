const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const GRAPHQL_URL = `https://${config.shopifyStore}/admin/api/2025-04/graphql.json`;

/**
 * Exchange authorization code for access token (one-time OAuth)
 */
async function exchangeCodeForToken(code) {
  const response = await axios.post(
    `https://${config.shopifyStore}/admin/oauth/access_token`,
    {
      client_id: config.shopifyClientId,
      client_secret: config.shopifyClientSecret,
      code,
    }
  );
  return response.data.access_token;
}

/**
 * Save access token to .env file
 */
function saveTokenToEnv(token) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  if (envContent.includes('SHOPIFY_ACCESS_TOKEN=')) {
    envContent = envContent.replace(
      /SHOPIFY_ACCESS_TOKEN=.*/,
      `SHOPIFY_ACCESS_TOKEN=${token}`
    );
  } else {
    envContent += `\nSHOPIFY_ACCESS_TOKEN=${token}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  process.env.SHOPIFY_ACCESS_TOKEN = token;
  config.shopifyAccessToken = token;
}

/**
 * Fetch all active product variants with inventory levels at configured locations
 */
async function fetchInventory() {
  if (!config.shopifyAccessToken) {
    throw new Error('No Shopify access token. Complete OAuth setup first.');
  }

  const allVariants = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `
      {
        products(first: 50, query: "status:active"${afterClause}) {
          pageInfo {
            hasNextPage
          }
          edges {
            cursor
            node {
              status
              publishedOnCurrentChannel
              variants(first: 100) {
                edges {
                  node {
                    sku
                    inventoryItem {
                      inventoryLevels(first: 10) {
                        edges {
                          node {
                            location {
                              id
                            }
                            quantities(names: ["available"]) {
                              name
                              quantity
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      GRAPHQL_URL,
      { query },
      {
        headers: {
          'X-Shopify-Access-Token': config.shopifyAccessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errors) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    const products = response.data.data.products;
    const edges = products.edges;

    for (const productEdge of edges) {
      const product = productEdge.node;

      // Skip drafts/unlisted
      if (product.status !== 'ACTIVE') continue;

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        if (!variant.sku) continue;

        let riversideQty = 0;
        let torProductionQty = 0;

        const levels = variant.inventoryItem.inventoryLevels.edges;
        for (const levelEdge of levels) {
          const level = levelEdge.node;
          const locationId = level.location.id;
          const available = level.quantities.find((q) => q.name === 'available');
          const qty = available ? available.quantity : 0;

          if (locationId === config.locationRiverside) {
            riversideQty = qty;
          } else if (locationId === config.locationTorProduction) {
            torProductionQty = qty;
          }
        }

        allVariants.push({
          partNumber: variant.sku,
          brand: config.brand,
          totalQuantity: riversideQty + torProductionQty,
          riversideWarehouse: riversideQty,
          torProduction: torProductionQty,
        });
      }
    }

    hasNextPage = products.pageInfo.hasNextPage;
    if (hasNextPage && edges.length > 0) {
      cursor = edges[edges.length - 1].cursor;
    }
  }

  return allVariants;
}

module.exports = { exchangeCodeForToken, saveTokenToEnv, fetchInventory };
