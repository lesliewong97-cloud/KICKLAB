export default async function handler(req, res) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const token = await getAccessToken(serviceAccount);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await readRes.json();
    const rows = data.values || [];

    // Build inventory object:
    // { "DV0833-102": { "UK 8": { full: 6, half: 0 }, "UK 8.5": { full: 3, half: 2 } } }
    const inventory = {};
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, fullBox, halfBox] = rows[i];
      if (!sku || !size) continue;
      if (!inventory[sku]) inventory[sku] = {};
      inventory[sku][size] = {
        full: parseInt(fullBox) || 0,
        half: parseInt(halfBox) || 0,
      };
    }

    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(inventory);
  } catch (error) {
    console.error('get-inventory error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch inventory' });
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
