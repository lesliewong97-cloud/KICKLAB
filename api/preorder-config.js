export default async function handler(req, res) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  if (req.method === 'GET') {
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/PreorderConfig!A:C`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const rows = (data.values || []).slice(1);
    const config = {};
    for (const [sku, size, active] of rows) {
      if (!sku || !size) continue;
      if (!config[sku]) config[sku] = {};
      config[sku][size] = active !== 'FALSE';
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(config);
  }

  if (req.method === 'POST') {
    const { sku, size, active } = req.body;
    if (!sku || !size) return res.status(400).json({ error: 'sku and size required' });
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/PreorderConfig!A:C`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const rows = data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === sku && rows[i][1] === size) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/PreorderConfig!C${i+1}?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[active ? 'TRUE' : 'FALSE']] }),
          }
        );
        return res.json({ ok: true, sku, size, active });
      }
    }
    return res.status(404).json({ error: 'SKU/size not found' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
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
