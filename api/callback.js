export default async function handler(req, res) {
  // Log everything we receive
  console.log('CALLBACK BODY:', JSON.stringify(req.body));
  console.log('CALLBACK QUERY:', JSON.stringify(req.query));

  const bill_id = req.body?.['billplz[id]'] || req.query?.['billplz[id]'];
  const paid = req.body?.['billplz[paid]'] || req.query?.['billplz[paid]'];
  const description = req.body?.['billplz[description]'] || req.query?.['billplz[description]'];

  console.log('bill_id:', bill_id);
  console.log('paid:', paid);
  console.log('description:', description);

  if (paid !== 'true') {
    console.log('Payment not successful, skipping inventory update');
    return res.redirect(302, '/?payment=failed');
  }

  try {
    const items = parseDescription(description);
    console.log('Parsed items:', JSON.stringify(items));

    if (items.length > 0) {
      await updateInventory(items);
      console.log('Inventory updated successfully');
    } else {
      console.log('No items parsed from description:', description);
    }

    return res.redirect(302, '/?payment=success');
  } catch (error) {
    console.error('Callback error:', error.message);
    return res.redirect(302, '/?payment=success');
  }
}

function parseDescription(desc) {
  if (!desc) return [];
  const items = [];
  const parts = desc.split(', ');
  for (const part of parts) {
    const ukMatch = part.match(/UK\s?([\d.]+)/i);
    const skuMatch = part.match(/\(([A-Z0-9-]+)\)/);
    const qtyMatch = part.match(/x(\d+)$/);
    console.log('Parsing part:', part, '| sku:', skuMatch?.[1], '| uk:', ukMatch?.[1], '| qty:', qtyMatch?.[1]);
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

  console.log('Getting access token...');
  const token = await getAccessToken(serviceAccount);
  console.log('Got access token');

  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:C`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  console.log('Sheet data:', JSON.stringify(data));
  const rows = data.values || [];

  const updates = [];
  for (const item of items) {
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, stock] = rows[i];
      if (sku === item.sku && size === item.size) {
        const newStock = Math.max(0, parseInt(stock) - item.qty);
        console.log(`Updating ${sku} ${size}: ${stock} -> ${newStock}`);
        updates.push({
          range: `Sheet1!C${i + 1}`,
          values: [[newStock]],
        });
      }
    }
  }

  if (updates.length > 0) {
    const updateRes = await fetch(
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
    const updateData = await updateRes.json();
    console.log('Update result:', JSON.stringify(updateData));
  } else {
    console.log('No matching rows found to update');
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
