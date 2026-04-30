const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const cronParser = require('cron-parser');
const cronstrue = require('cronstrue');
const config = require('./config');
const { exchangeCodeForToken, saveTokenToEnv } = require('./shopify');
const { getRecentSends, getLastSuccess, getLastSuccessfulRun, getRecentRuns, getRecipients, addRecipient, removeRecipient } = require('./db');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// OAuth callback
// ---------------------------------------------------------------------------
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, shop, hmac } = req.query;

    if (!code || !shop) {
      return res.status(400).send('Missing code or shop parameter');
    }

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

    const token = await exchangeCodeForToken(code);
    saveTokenToEnv(token);

    console.log('OAuth complete. Access token saved.');
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Setup Complete</title>
<style>body{font-family:'DM Sans',system-ui,sans-serif;text-align:center;padding:60px;background:#f6f6f1;color:#1a1a18}h1{font-size:24px}</style>
</head><body><h1>Setup Complete</h1><p>Access token saved. The inventory feed is now ready.</p><p>You can close this window.</p></body></html>`);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  // Block direct browser access — only allow inside Shopify Admin iframe
  const shop = req.query.shop || req.headers['x-shopify-shop-domain'];
  const embedded = req.query.embedded || req.query.hmac || req.query.timestamp || shop;
  if (!embedded) {
    return res.status(403).type('html').send(`<!DOCTYPE html>
<html><head><title>Access Denied</title></head>
<body style="font-family:'DM Sans',system-ui,sans-serif;text-align:center;padding:60px;background:#f6f6f1;color:#1a1a18">
<h1>Access Denied</h1>
<p>This app can only be accessed from the Shopify Admin.</p>
<p style="margin-top:20px"><a href="https://${config.shopifyStore}/admin/apps" style="color:#2a6b4a;font-weight:600">Go to Shopify Admin → Apps</a></p>
</body></html>`);
  }

  if (!config.shopifyAccessToken) {
    const scopes = 'read_products,read_inventory,read_locations';
    const redirectUri = `${config.appUrl}/auth/callback`;
    const installUrl = `https://${config.shopifyStore}/admin/oauth/authorize?client_id=${config.shopifyClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return res.type('html').send(`<!DOCTYPE html>
<html><head><title>Setup</title></head><body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>Inventory Feed — Setup Required</h1>
<a href="${installUrl}" style="display:inline-block;background:#2a6b4a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:16px">Authorize App</a>
</body></html>`);
  }

  // Compute uptime
  const uptimeSeconds = Math.floor(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptimeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Last successful run
  let lastFeedSent = 'No runs yet';
  try {
    const lastRun = getLastSuccessfulRun();
    if (lastRun) lastFeedSent = lastRun.completed_at;
  } catch (e) {}

  // Next scheduled run
  let nextRun = 'Unknown';
  try {
    const interval = cronParser.parseExpression(config.cronSchedule, { tz: config.timezone });
    nextRun = interval.next().toISOString().replace('T', ' ').slice(0, 16) + ' ' + config.timezone;
  } catch (e) {}

  // Schedule description
  let scheduleDesc = config.cronSchedule;
  try {
    scheduleDesc = cronstrue.toString(config.cronSchedule);
  } catch (e) {}

  // Warehouses
  const warehouses = ['Riverside Warehouse', 'TOR Production'];

  // Recipients from SQLite
  let recipientsList = [];
  try { recipientsList = getRecipients(); } catch (e) {}
  const recipientsDisplay = recipientsList.length > 0 ? recipientsList.map(r => r.email).join(', ') : 'No recipients configured';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inventory Feed Integration</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

  *{margin:0;padding:0;box-sizing:border-box}

  :root{
    --bg:#f6f6f1;
    --card:#ffffff;
    --border:#e2e0d8;
    --text:#1a1a18;
    --text-secondary:#6b6960;
    --accent:#2a6b4a;
    --accent-light:#e8f3ed;
    --accent-warm:#c97d3c;
    --accent-warm-light:#fef6ee;
    --mono:#5c6b5e;
    --shadow:0 1px 3px rgba(26,26,24,.06),0 1px 2px rgba(26,26,24,.04);
    --shadow-lg:0 4px 12px rgba(26,26,24,.08),0 1px 3px rgba(26,26,24,.06);
    --radius:10px;
  }

  body{
    font-family:'DM Sans',system-ui,-apple-system,sans-serif;
    background:var(--bg);
    color:var(--text);
    line-height:1.55;
    -webkit-font-smoothing:antialiased;
    padding:0;
    min-height:100vh;
  }

  .shell{
    max-width:840px;
    margin:0 auto;
    padding:32px 24px 48px;
  }

  /* ── header ── */
  .header{
    display:flex;
    align-items:center;
    gap:14px;
    margin-bottom:32px;
    padding-bottom:24px;
    border-bottom:1px solid var(--border);
  }
  .header-icon{
    width:42px;height:42px;
    background:var(--accent);
    border-radius:10px;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
  }
  .header-icon svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
  .header h1{font-size:20px;font-weight:700;letter-spacing:-.3px;color:var(--text)}
  .header p{font-size:13px;color:var(--text-secondary);margin-top:2px}

  /* ── cards ── */
  .card{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:var(--radius);
    box-shadow:var(--shadow);
    padding:24px;
    margin-bottom:16px;
  }
  .card-label{
    font-size:11px;
    font-weight:600;
    text-transform:uppercase;
    letter-spacing:.8px;
    color:var(--text-secondary);
    margin-bottom:16px;
    display:flex;align-items:center;gap:6px;
  }
  .card-label svg{width:14px;height:14px;stroke:var(--text-secondary);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* ── status ── */
  .status-row{
    display:flex;
    align-items:center;
    gap:24px;
    flex-wrap:wrap;
  }
  .status-item{display:flex;flex-direction:column;gap:4px}
  .status-item .label{font-size:12px;color:var(--text-secondary);font-weight:500}
  .status-item .value{font-family:'DM Mono',monospace;font-size:14px;font-weight:500;color:var(--text)}
  .status-dot{
    display:inline-flex;align-items:center;gap:7px;
    font-family:'DM Mono',monospace;font-size:14px;font-weight:500;
    color:var(--accent);
  }
  .status-dot::before{
    content:'';display:inline-block;
    width:8px;height:8px;
    background:var(--accent);
    border-radius:50%;
    box-shadow:0 0 0 3px var(--accent-light);
    animation:pulse 2.5s ease-in-out infinite;
  }
  @keyframes pulse{
    0%,100%{box-shadow:0 0 0 3px var(--accent-light)}
    50%{box-shadow:0 0 0 6px rgba(42,107,74,.08)}
  }

  .divider{
    width:100%;height:1px;
    background:var(--border);
    margin:20px 0;
  }

  /* ── steps ── */
  .steps{display:flex;flex-direction:column;gap:0}
  .step{
    display:flex;
    align-items:flex-start;
    gap:16px;
    padding:14px 0;
    position:relative;
  }
  .step+.step{border-top:1px dashed var(--border)}
  .step-num{
    width:28px;height:28px;
    border-radius:50%;
    background:var(--accent-light);
    color:var(--accent);
    font-family:'DM Mono',monospace;
    font-size:12px;font-weight:600;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
    margin-top:1px;
  }
  .step-content h3{font-size:14px;font-weight:600;margin-bottom:3px;color:var(--text)}
  .step-content p{font-size:13px;color:var(--text-secondary);line-height:1.5}

  /* ── config grid ── */
  .config-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:0;
  }
  .config-item{
    padding:14px 0;
    border-bottom:1px solid var(--border);
  }
  .config-item:nth-child(odd){padding-right:20px;border-right:1px solid var(--border)}
  .config-item:nth-child(even){padding-left:20px}
  .config-item:nth-last-child(-n+2){border-bottom:none}
  .config-item .label{font-size:12px;color:var(--text-secondary);font-weight:500;margin-bottom:4px}
  .config-item .value{font-family:'DM Mono',monospace;font-size:13px;color:var(--text);font-weight:500;word-break:break-all}
  .config-item .value.tag{
    display:inline-flex;gap:6px;flex-wrap:wrap;
  }
  .tag-pill{
    background:var(--accent-warm-light);
    color:var(--accent-warm);
    font-family:'DM Mono',monospace;
    font-size:11px;font-weight:600;
    padding:3px 10px;
    border-radius:20px;
    letter-spacing:.3px;
  }

  /* ── links ── */
  .links{
    display:flex;gap:10px;flex-wrap:wrap;
  }
  .link-btn{
    display:inline-flex;align-items:center;gap:8px;
    padding:10px 18px;
    background:var(--card);
    border:1px solid var(--border);
    border-radius:8px;
    font-family:'DM Sans',sans-serif;
    font-size:13px;font-weight:600;
    color:var(--text);
    text-decoration:none;
    transition:all .15s ease;
    box-shadow:var(--shadow);
    cursor:pointer;
  }
  .link-btn:hover{
    border-color:var(--accent);
    color:var(--accent);
    box-shadow:var(--shadow-lg);
    transform:translateY(-1px);
  }
  .link-btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* ── footer ── */
  .footer{
    text-align:center;
    padding-top:32px;
    font-size:12px;
    color:var(--text-secondary);
    letter-spacing:.2px;
  }
  .footer span{font-weight:600;color:var(--text)}

  /* ── two-column layout for status + links ── */
  .row-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:640px){
    .row-2{grid-template-columns:1fr}
    .config-grid{grid-template-columns:1fr}
    .config-item:nth-child(odd){padding-right:0;border-right:none}
    .config-item:nth-child(even){padding-left:0}
  }
</style>
</head>
<body>
<div class="shell">

  <div class="header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24"><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
    </div>
    <div>
      <h1>Inventory Feed</h1>
      <p>Daily inventory CSV delivery for Turn Offroad partners</p>
    </div>
  </div>

  <div class="row-2">
    <div class="card">
      <div class="card-label">
        <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        System Status
      </div>
      <div class="status-row">
        <div class="status-item">
          <span class="label">Server</span>
          <span class="status-dot">Online</span>
        </div>
        <div class="status-item">
          <span class="label">Uptime</span>
          <span class="value">${uptimeStr}</span>
        </div>
      </div>
      <div class="divider"></div>
      <div class="status-item">
        <span class="label">Last checked</span>
        <span class="value" style="font-size:12px;color:var(--text-secondary)">${timestamp}</span>
      </div>
      <div class="divider"></div>
      <div class="status-row">
        <div class="status-item">
          <span class="label">Last feed sent</span>
          <span class="value" style="font-size:12px;color:var(--text-secondary)">${lastFeedSent}</span>
        </div>
        <div class="status-item">
          <span class="label">Next scheduled run</span>
          <span class="value" style="font-size:12px;color:var(--text-secondary)">${nextRun}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Quick Links
      </div>
      <div class="links" style="flex-direction:column">
        <a class="link-btn" href="/api/run-now" onclick="event.preventDefault();fetch('/api/run-now',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>alert(d.message||d.error)).catch(e=>alert('Error: '+e.message))">
          <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Send Feed Now
        </a>
        <a class="link-btn" href="/api/health" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          Health Check
        </a>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      How It Works
    </div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>Cron Triggered</h3>
          <p>Every day at the configured time, the scheduler kicks off the feed job.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Inventory Pulled</h3>
          <p>The server queries Shopify Admin API for active variants in <strong>TOR Production</strong> and <strong>Riverside</strong> warehouses, excluding drafts and unlisted items.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>CSV Generated</h3>
          <p>A CSV is built per APG's template — SKU, brand (hardcoded <strong>"Turn Offroad"</strong>), and total sellable quantity per warehouse.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h3>Email Delivered</h3>
          <p>The CSV is emailed to all configured recipients with a fixed subject line. Each delivery is logged.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Configuration
    </div>
    <div class="config-grid">
      <div class="config-item">
        <div class="label">Schedule</div>
        <div class="value">${scheduleDesc}</div>
      </div>
      <div class="config-item">
        <div class="label">Recipients</div>
        <div class="value">${recipientsDisplay}</div>
      </div>
      <div class="config-item">
        <div class="label">Warehouses monitored</div>
        <div class="value tag">
          ${warehouses.map((w) => `<span class="tag-pill">${w}</span>`).join('')}
        </div>
      </div>
      <div class="config-item">
        <div class="label">Subject line</div>
        <div class="value">${config.emailSubject}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Manage Recipients
    </div>
    <div style="margin-bottom:16px">
      <form id="addRecipientForm" style="display:flex;gap:8px;align-items:center">
        <input type="email" id="newEmail" placeholder="Enter email address" required style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;transition:border-color .15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" />
        <button type="submit" style="padding:10px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Add Recipient</button>
      </form>
    </div>
    <div id="recipientsList">
      ${recipientsList.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px">No recipients added yet.</p>' : recipientsList.map(r => `
      <div class="recipient-row" id="recipient-${r.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <svg style="width:16px;height:16px;stroke:var(--accent);fill:none;stroke-width:2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <span style="font-family:'DM Mono',monospace;font-size:13px;font-weight:500">${r.email}</span>
        </div>
        <button onclick="removeRecipient(${r.id})" style="padding:6px 12px;background:none;border:1px solid #e5534b;border-radius:6px;color:#e5534b;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s" onmouseover="this.style.background='#e5534b';this.style.color='#fff'" onmouseout="this.style.background='none';this.style.color='#e5534b'">Remove</button>
      </div>`).join('')}
    </div>
  </div>

  <script>
    document.getElementById('addRecipientForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const email = document.getElementById('newEmail').value.trim();
      if (!email) return;
      try {
        const res = await fetch('/api/recipients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          location.reload();
        } else {
          alert(data.error || 'Failed to add recipient');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });

    async function removeRecipient(id) {
      if (!confirm('Remove this recipient?')) return;
      try {
        const res = await fetch('/api/recipients/' + id, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          document.getElementById('recipient-' + id).remove();
        } else {
          alert(data.error || 'Failed to remove');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  </script>

  <div class="footer">Built by <a href="https://www.cloveode.com/" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">CloveOde</a></div>

</div>
</body>
</html>`;

  res.type('html').send(html);
});

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (req, res) => {
  let lastRun = null;
  let lastStatus = null;
  try {
    const run = getLastSuccessfulRun();
    if (run) {
      lastRun = run.completed_at;
      lastStatus = run.status;
    }
  } catch (e) {}

  let nextRun = null;
  try {
    const interval = cronParser.parseExpression(config.cronSchedule, { tz: config.timezone });
    nextRun = interval.next().toISOString();
  } catch (e) {}

  res.json({
    last_run: lastRun,
    next_run: nextRun,
    last_status: lastStatus,
    recipient_count: getRecipients().length,
  });
});

app.get('/api/logs', (req, res) => {
  try {
    const runs = getRecentRuns(50);
    res.json(runs);
  } catch (e) {
    res.json([]);
  }
});

// Recipients API
app.get('/api/recipients', (req, res) => {
  try {
    const recipients = getRecipients();
    res.json({ success: true, recipients });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/recipients', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }
    addRecipient(email.trim().toLowerCase());
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/recipients/:id', (req, res) => {
  try {
    removeRecipient(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/run-now - protected, triggers immediate feed
// The runFeed function is injected via setRunFeedFn after index.js wires everything
let _runFeed = null;

function setRunFeedFn(fn) {
  _runFeed = fn;
}

app.post('/api/run-now', async (req, res) => {
  if (!_runFeed) {
    return res.status(500).json({ error: 'Feed function not initialized' });
  }

  try {
    _runFeed();
    res.json({ message: 'Feed job triggered. Check /api/logs for results.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startServer() {
  app.listen(config.port, () => {
    console.log(`Inventory Feed server running on port ${config.port}`);
  });
}

module.exports = { app, startServer, setRunFeedFn };
