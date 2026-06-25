export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, items } = req.body || {};
  if (password !== 'Kicklab1234@') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }

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

    const updates = [];
    const results = [];

    for (const item of items) {
      const sku = item.sku;
      const size = item.size;
      const box = item.box; // 'full' or 'half'
      const qty = parseInt(item.qty) || 1;
      let matched = false;

      for (let i = 1; i < rows.length; i++) {
        const [rSku, rSize, fullBox, halfBox, stock] = rows[i];
        if (rSku === sku && rSize === size) {
          matched = true;
          const newStock = Math.max(0, parseInt(stock || 0) - qty);
          updates.push({ range: `Inventory!E${i + 1}`, values: [[newStock]] });
          if (box === 'half') {
            const newHalf = Math.max(0, parseInt(halfBox || 0) - qty);
            updates.push({ range: `Inventory!D${i + 1}`, values: [[newHalf]] });
            results.push({ sku, size, box, qty, newHalf, newStock });
          } else {
            const newFull = Math.max(0, parseInt(fullBox || 0) - qty);
            updates.push({ range: `Inventory!C${i + 1}`, values: [[newFull]] });
            results.push({ sku, size, box: box || 'full', qty, newFull, newStock });
          }
          break;
        }
      }
      if (!matched) {
        results.push({ sku, size, box, qty, error: 'Row not found in Inventory sheet' });
      }
    }

    if (updates.length > 0) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
        }
      );
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    console.error('admin-inventory error:', error.message);
    return res.status(500).json({ error: 'Failed to update inventory' });
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
