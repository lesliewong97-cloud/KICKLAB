const ADMIN_PASSWORD = 'Kicklab1234@';
const SHEET_NAME = 'DiscountCodes';
const HEADERS = ['Code','Type','Value','MaxUses','UsedCount','Active'];

export default async function handler(req, res) {
  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { action, code } = body;

    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const token = await getAccessToken(serviceAccount);

    if (action === 'validate') {
      if (!code) return res.status(200).json({ valid: false, reason: 'missing' });
      await ensureSheet(sheetId, token);
      const rows = await readSheet(sheetId, token);
      const upper = code.trim().toUpperCase();
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if ((r[0] || '').trim().toUpperCase() === upper) {
          const active = (r[5] || 'TRUE').toUpperCase() !== 'FALSE';
          const maxUses = parseInt(r[3] || '0');
          const used = parseInt(r[4] || '0');
          if (!active) return res.status(200).json({ valid: false, reason: 'inactive' });
          if (maxUses > 0 && used >= maxUses) return res.status(200).json({ valid: false, reason: 'limit' });
          return res.status(200).json({
            valid: true,
            code: r[0],
            type: r[1],
            value: parseFloat(r[2] || '0'),
            label: labelFor(r[1], r[2]),
          });
        }
      }
      return res.status(200).json({ valid: false, reason: 'notfound' });
    }

    const { password } = body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    if (action === 'list') {
      await ensureSheet(sheetId, token);
      const rows = await readSheet(sheetId, token);
      const codes = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[0]) continue;
        codes.push({
          row: i + 1,
          code: r[0],
          type: r[1] || '',
          value: r[2] || '0',
          maxUses: r[3] || '0',
          used: r[4] || '0',
          active: (r[5] || 'TRUE').toUpperCase() !== 'FALSE',
        });
      }
      return res.status(200).json({ codes });
    }

    if (action === 'add') {
      const { type, value, maxUses } = body;
      if (!code || !type) return res.status(400).json({ error: 'Missing code or type' });
      await ensureSheet(sheetId, token);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A:F:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[code.trim().toUpperCase(), type, value || 0, maxUses || 0, 0, 'TRUE']] }),
        }
      );
      return res.status(200).json({ message: 'ok' });
    }

    if (action === 'toggle') {
      const { row } = body;
      const rows = await readSheet(sheetId, token);
      const current = (rows[row - 1][5] || 'TRUE').toUpperCase() === 'FALSE' ? 'TRUE' : 'FALSE';
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!F${row}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[current]] }),
        }
      );
      return res.status(200).json({ message: 'ok' });
    }

    if (action === 'delete') {
      const { row } = body;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A${row}:F${row}:clear`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );
      return res.status(200).json({ message: 'ok' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function labelFor(type, value) {
  if (type === 'freeship') return 'Free Shipping';
  if (type === 'percent') return `${value}% Off`;
  if (type === 'fixed') return `RM${value} Off`;
  return 'Discount';
}

async function readSheet(sheetId, token) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A:F`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  return d.values || [];
}

async function ensureSheet(sheetId, token) {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  const exists = (meta.sheets || []).some(s => s.properties.title === SHEET_NAME);
  if (!exists) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }),
      }
    );
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A1:F1?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADERS] }),
      }
    );
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${encode(header)}.${encode(payload)}`;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}
