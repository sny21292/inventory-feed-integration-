const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const { exchangeCodeForToken, saveTokenToEnv } = require('./shopify');
const { getRecentSends, getLastSuccess } = require('./db');

const app = express();

/**
 * OAuth callback - Shopify redirects here with authorization code
 */
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, shop, hmac, timestamp } = req.query;

    if (!code || !shop) {
      return res.status(400).send('Missing code or shop parameter');
    }

    // Verify HMAC
    const params = { ...req.query };
    delete params.hmac;
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    const hash = crypto
      .createHmac('sha256', config.shopifyClientSecret)
      .update(sortedParams)
      .digest('hex');

    if (hash !== hmac) {
      return res.status(401).send('HMAC verification failed');
    }

    // Exchange code for access token
    const token = await exchangeCodeForToken(code);
    saveTokenToEnv(token);

    console.log('OAuth complete. Access token saved.');
    res.send(`
      <html>
        <head><title>Setup Complete</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 60px;">
          <h1>Setup Complete</h1>
          <p>Access token has been saved. The inventory feed is now ready.</p>
          <p>You can close this window and go back to Shopify Admin.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

/**
 * Dashboard - shows feed status (loads inside Shopify Admin iframe)
 */
app.get('/', (req, res) => {
  if (!config.shopifyAccessToken) {
    // Not set up yet - show setup link
    const scopes = 'read_products,read_inventory,read_locations';
    const redirectUri = `${config.appUrl}/auth/callback`;
    const installUrl = `https://${config.shopifyStore}/admin/oauth/authorize?client_id=${config.shopifyClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    return res.send(`
      <html>
        <head><title>Inventory Feed - Setup</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
          <h1>Inventory Feed Integration</h1>
          <p>Setup required. Click the button below to authorize the app.</p>
          <a href="${installUrl}" style="display: inline-block; background: #008060; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 16px;">
            Authorize App
          </a>
        </body>
      </html>
    `);
  }

  // Dashboard view
  let lastSuccess = null;
  let recentSends = [];
  try {
    lastSuccess = getLastSuccess();
    recentSends = getRecentSends(10);
  } catch (e) {
    // DB may not exist yet
  }

  const now = new Date().toLocaleString('en-US', { timeZone: config.timezone });
  const nextRun = config.cronSchedule;

  const historyRows = recentSends
    .map(
      (s) =>
        `<tr>
          <td>${s.sent_at}</td>
          <td>${s.recipient}</td>
          <td>${s.row_count}</td>
          <td style="color: ${s.status === 'success' ? '#008060' : '#d72c0d'}">${s.status}</td>
          <td>${s.error || '-'}</td>
        </tr>`
    )
    .join('');

  res.send(`
    <html>
      <head>
        <title>Inventory Feed Integration</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #f6f6f7; color: #1a1a1a; }
          .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
          .header h1 { font-size: 20px; font-weight: 600; }
          .header p { color: #6d7175; font-size: 14px; }
          .card { background: white; border: 1px solid #e1e3e5; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
          .card h2 { font-size: 14px; font-weight: 600; color: #6d7175; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
          .status-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
          .status-item label { display: block; font-size: 12px; color: #6d7175; margin-bottom: 4px; }
          .status-item .value { font-size: 16px; font-weight: 600; }
          .online { color: #008060; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e1e3e5; }
          th { font-weight: 600; color: #6d7175; font-size: 12px; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Inventory Feed Integration</h1>
            <p>Daily CSV feed for Turn Offroad</p>
          </div>
        </div>

        <div class="card">
          <h2>System Status</h2>
          <div class="status-grid">
            <div class="status-item">
              <label>Server</label>
              <div class="value online">Online</div>
            </div>
            <div class="status-item">
              <label>Schedule</label>
              <div class="value">${nextRun} (${config.timezone})</div>
            </div>
            <div class="status-item">
              <label>Last Success</label>
              <div class="value">${lastSuccess ? lastSuccess.sent_at : 'No runs yet'}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Configuration</h2>
          <div class="status-grid">
            <div class="status-item">
              <label>Recipients</label>
              <div class="value">${config.recipients.length > 0 ? config.recipients.join(', ') : 'Not configured'}</div>
            </div>
            <div class="status-item">
              <label>Brand</label>
              <div class="value">${config.brand}</div>
            </div>
            <div class="status-item">
              <label>Warehouses</label>
              <div class="value">Riverside, TOR Production</div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Recent Send History</h2>
          ${
            recentSends.length > 0
              ? `<table>
                  <thead>
                    <tr><th>Date</th><th>Recipient</th><th>Rows</th><th>Status</th><th>Error</th></tr>
                  </thead>
                  <tbody>${historyRows}</tbody>
                </table>`
              : '<p style="color: #6d7175; font-size: 14px;">No sends yet. Run the feed manually with: npm run once</p>'
          }
        </div>

        <p style="text-align: center; color: #6d7175; font-size: 12px; margin-top: 24px;">
          Current time: ${now}
        </p>
      </body>
    </html>
  `);
});

function startServer() {
  app.listen(config.port, () => {
    console.log(`Inventory Feed server running on port ${config.port}`);
  });
}

module.exports = { app, startServer };
