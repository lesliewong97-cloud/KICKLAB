export default async function handler(req, res) {
  const bill_id = req.body?.['billplz[id]'] || req.query?.['billplz[id]'];
  const paid = req.body?.['billplz[paid]'] || req.query?.['billplz[paid]'];
  const description = req.body?.['billplz[description]'] || req.query?.['billplz[description]'];

  if (paid !== 'true') {
    return res.redirect(302, '/?payment=failed');
  }

  try {
    // Parse items from description e.g. "Court Lite 4 UK7.5 x1, ..."
    const items = parseDescription(description);

    if (items.length > 0) {
      await updateInventory(items);
    }

    return res.redirect(302, '/?payment=success');
  } catch (error) {
    console.error('Callback error:', error);
    return res.redirect(302, '/?payment=success'); // still redirect to success
  }
}

function parseDescription(desc) {
  if (!desc) return [];
  const items = [];
  const parts = desc.split(', ');
  for (const part of parts) {
    const ukMatch = part.match(/UK\s?([\d.]+)/i);
    const skuMatch = part.match(/\(([A-Z0-9-]+)\)/);
    const qtyMatch = part.match(/x(\d+)/);
    if (ukMatch && skuMatch) {
      items.push({
        sku: skuMatch[1],
        size: 'UK ' + ukMatch[1],
        qty: qtyMatch ? parseInt(qtyMatch[1]) : 1,
      });
    }
  }
  return items;
}

async function updateInventory(items) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  // Get JWT token
  const token = await getAccessToken(serviceAccount);

  // Read current sheet
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:C`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];

  // Update stock for each item
  const updates = [];
  for (const item of items) {
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, stock] = rows[i];
      if (sku === item.sku && size === item.size) {
        const newStock = Math.max(0, parseInt(stock) - item.qty);
        updates.push({
          range: `Sheet1!C${i + 1}`,
          values: [[newStock]],
        });
      }
    }
  }

  if (updates.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: updates,
        }),
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

  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  // Sign with RS256
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
