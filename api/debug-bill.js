export default async function handler(req, res) {
  const bill_id = req.query.bill_id;
  const sku = req.query.sku;

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  // Restore inventory
  if (req.query.action === 'restore') {
    const restoreSku = req.query.sku;
    const restoreSize = req.query.size;
    const restoreQty = parseInt(req.query.qty || '1');
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const rows = data.values || [];
    const norm = s => String(s == null ? '' : s).replace(/^UKs*/i, '').trim();
    const updates = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === restoreSku && norm(rows[i][1]) === norm(restoreSize)) {
        const newFull = parseInt(rows[i][2] || 0) + restoreQty;
        const newStock = parseInt(rows[i][4] || 0) + restoreQty;
        updates.push({ range: `Inventory!C${i+1}`, values: [[newFull]] });
        updates.push({ range: `Inventory!E${i+1}`, values: [[newStock]] });
        break;
      }
    }
    if (updates.length > 0) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      });
      return res.json({ ok: true, restored: { sku: restoreSku, size: restoreSize, qty: restoreQty } });
    }
    return res.json({ ok: false, error: 'not found' });
  }

  if (sku && !req.query.action) {
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const rows = data.values || [];
    const matches = rows.filter(row => row[0] === sku);
    return res.json({ sku, rows: matches });
  }

  if (req.query.order) {
    const orderNum = req.query.order;
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Orders!A:L`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const rows = data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === orderNum) {
        let items = [];
        try { items = JSON.parse(rows[i][6] || '[]'); } catch(e) {}
        return res.json({ orderNum, status: rows[i][11], items });
      }
    }
    return res.json({ orderNum, error: 'not found' });
  }

  if (bill_id) {
    const SANDBOX = process.env.BILLPLZ_SANDBOX === 'true';
    const BASE = SANDBOX ? 'https://www.billplz-sandbox.com/api/v3/bills' : 'https://www.billplz.com/api/v3/bills';
    const credentials = Buffer.from(`${process.env.BILLPLZ_API_KEY}:`).toString('base64');
    const r = await fetch(`${BASE}/${bill_id}`, { headers: { Authorization: `Basic ${credentials}` } });
    const bill = await r.json();
    return res.json({ bill_id, description: bill.description, paid: bill.paid, name: bill.name });
  }

  return res.json({ usage: '?bill_id= | ?sku= | ?order= | ?action=restore&sku=&size=&qty=' });
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}
