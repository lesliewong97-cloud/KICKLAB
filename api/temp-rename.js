export default async function handler(req, res) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = '1Unm3WjHSswhXAzwjN8lNNGRf38By_X41lSHnhIOsU0c';
    const token = await getAccessToken(serviceAccount);

    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    const sheet2 = (meta.sheets || []).find(s => s.properties.title === 'Sheet2');
    if (!sheet2) {
      return res.status(404).json({ error: 'Sheet2 not found', sheets: (meta.sheets||[]).map(s=>s.properties.title) });
    }

    const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: sheet2.properties.sheetId, title: 'Customer Reviews' },
            fields: 'title',
          },
        }],
      }),
    });
    const updateData = await updateRes.json();
    return res.status(200).json({ ok: true, updateData });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
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
