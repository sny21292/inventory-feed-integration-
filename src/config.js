require('dotenv').config();

const required = [
  'SHOPIFY_STORE',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_LOCATION_RIVERSIDE',
  'SHOPIFY_LOCATION_TOR_PRODUCTION',
  'RESEND_API_KEY',
  'FROM_EMAIL',
  'ALERT_EMAIL',
  'RECIPIENTS',
  'EMAIL_SUBJECT',
  'CRON_SCHEDULE',
  'TIMEZONE',
];

const missing = required.filter((key) => !process.env[key]);

// Allow missing during initial setup (before OAuth token is obtained)
const setupMode = !process.env.SHOPIFY_ACCESS_TOKEN;

if (missing.length > 0 && !setupMode) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

module.exports = {
  // Shopify
  shopifyStore: process.env.SHOPIFY_STORE,
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  shopifyAccessToken: process.env.SHOPIFY_ACCESS_TOKEN || null,
  locationRiverside: process.env.SHOPIFY_LOCATION_RIVERSIDE,
  locationTorProduction: process.env.SHOPIFY_LOCATION_TOR_PRODUCTION,

  // Email
  resendApiKey: process.env.RESEND_API_KEY,
  fromEmail: process.env.FROM_EMAIL,
  alertEmail: process.env.ALERT_EMAIL,
  recipients: (process.env.RECIPIENTS || '').split(',').map((e) => e.trim()).filter(Boolean),
  emailSubject: process.env.EMAIL_SUBJECT || 'Turn Offroad Daily Inventory Feed',

  // Schedule
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *',
  timezone: process.env.TIMEZONE || 'America/New_York',

  // Server
  port: parseInt(process.env.PORT, 10) || 3002,
  appUrl: process.env.APP_URL || 'https://inventoryfeed-turnoffroad.duckdns.org',

  // Brand
  brand: 'Turn Offroad',

  // Setup mode flag
  setupMode,
};
