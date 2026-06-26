export default async function handler(req, res) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  // Create PreorderConfig sheet if not exists
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers: { Authorization: `Bearer ${token}` } });
  const meta = await metaRes.json();
  const exists = (meta.sheets || []).some(s => s.properties.title === 'PreorderConfig');
  if (!exists) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'PreorderConfig' } } }] }),
    });
  }

  // Write all rows
  const rows = [["SKU","Size","Active"],["FZ2161-101","UK 6","TRUE"],["FZ2161-101","UK 6.5","TRUE"],["FZ2161-101","UK 7","TRUE"],["FZ2161-101","UK 7.5","TRUE"],["FZ2161-101","UK 8","TRUE"],["FZ2161-101","UK 8.5","TRUE"],["FZ2161-101","UK 9","TRUE"],["FZ2161-101","UK 9.5","TRUE"],["FZ2161-101","UK 10","TRUE"],["CZ0220-177","UK 7","TRUE"],["CZ0220-177","UK 7.5","TRUE"],["CZ0220-177","UK 8","TRUE"],["CZ0220-177","UK 8.5","TRUE"],["CZ0220-177","UK 9","TRUE"],["CZ0220-177","UK 9.5","TRUE"],["CZ0220-177","UK 10","TRUE"],["HM3705-141","UK 6","TRUE"],["HM3705-141","UK 6.5","TRUE"],["HM3705-141","UK 7","TRUE"],["HM3705-141","UK 7.5","TRUE"],["HM3705-141","UK 8","TRUE"],["HM3705-141","UK 8.5","TRUE"],["HM3705-141","UK 9","TRUE"],["HM3705-141","UK 9.5","TRUE"],["HM3705-141","UK 10","TRUE"],["FZ2161-104","UK 6.5","TRUE"],["FZ2161-104","UK 7","TRUE"],["FZ2161-104","UK 7.5","TRUE"],["FZ2161-104","UK 8","TRUE"],["FZ2161-104","UK 8.5","TRUE"],["FZ2161-104","UK 9","TRUE"],["FZ2161-104","UK 9.5","TRUE"],["FZ2161-108","UK 6","TRUE"],["FZ2161-108","UK 6.5","TRUE"],["FZ2161-108","UK 7","TRUE"],["FZ2161-108","UK 7.5","TRUE"],["FZ2161-108","UK 8","TRUE"],["FZ2161-108","UK 8.5","TRUE"],["FZ2161-108","UK 9","TRUE"],["FZ2161-108","UK 9.5","TRUE"],["HV1376-601","UK 2.5","TRUE"],["HV1376-601","UK 3","TRUE"],["HV1376-601","UK 3.5","TRUE"],["HV1376-601","UK 4","TRUE"],["HV1376-601","UK 4.5","TRUE"],["HV1376-601","UK 5","TRUE"],["HV1376-601","UK 5.5","TRUE"],["HV1376-601","UK 6","TRUE"],["HV1376-601","UK 6.5","TRUE"],["HV1376-601","UK 7","TRUE"],["HV1376-601","UK 7.5","TRUE"],["1041A481-100","UK 5.5","TRUE"],["1041A481-100","UK 6","TRUE"],["1041A481-100","UK 6.5","TRUE"],["1041A481-100","UK 7","TRUE"],["1041A481-100","UK 7.5","TRUE"],["1041A481-100","UK 8","TRUE"],["1041A481-100","UK 8.5","TRUE"],["1041A481-100","UK 9","TRUE"],["1041A481-100","UK 9.5","TRUE"],["1041A481-100","UK 10","TRUE"],["1042A279-105","UK 3","TRUE"],["1042A279-105","UK 3.5","TRUE"],["1042A279-105","UK 4","TRUE"],["1042A279-105","UK 4.5","TRUE"],["1042A279-105","UK 5","TRUE"],["1042A279-105","UK 5.5","TRUE"],["1042A279-105","UK 6","TRUE"],["1042A279-105","UK 6.5","TRUE"],["IQ1156-110","UK 5","TRUE"],["IQ1156-110","UK 5.5","TRUE"],["IQ1156-110","UK 6","TRUE"],["IQ1156-110","UK 6.5","TRUE"],["IQ1156-110","UK 7","TRUE"],["IQ1156-110","UK 7.5","TRUE"],["IQ1156-110","UK 8","TRUE"],["IQ1156-110","UK 9","TRUE"],["IQ1156-110","UK 9.5","TRUE"],["FZ2161-109","UK 6","TRUE"],["FZ2161-109","UK 6.5","TRUE"],["FZ2161-109","UK 7","TRUE"],["FZ2161-109","UK 7.5","TRUE"],["FZ2161-109","UK 8","TRUE"],["FZ2161-109","UK 8.5","TRUE"],["FZ2161-109","UK 9","TRUE"],["FZ2161-109","UK 9.5","TRUE"],["FZ2161-109","UK 10","TRUE"],["JP5379","UK 6.5","TRUE"],["JP5379","UK 7","TRUE"],["JP5379","UK 7.5","TRUE"],["JP5379","UK 8","TRUE"],["JP5379","UK 8.5","TRUE"],["JP5379","UK 9","TRUE"],["JP5379","UK 9.5","TRUE"],["JP5379","UK 10","TRUE"],["JP5379","UK 10.5","TRUE"],["FB3146-100","UK 2.5","TRUE"],["FB3146-100","UK 3","TRUE"],["FB3146-100","UK 3.5","TRUE"],["FB3146-100","UK 4","TRUE"],["FB3146-100","UK 4.5","TRUE"],["FB3146-100","UK 5","TRUE"],["FB3146-100","UK 5.5","TRUE"],["FB3146-100","UK 6","TRUE"],["FB3146-100","UK 6.5","TRUE"],["FB3146-100","UK 7","TRUE"],["FB3146-100","UK 7.5","TRUE"],["II7102-601","UK 2.5","TRUE"],["II7102-601","UK 3","TRUE"],["II7102-601","UK 3.5","TRUE"],["II7102-601","UK 4","TRUE"],["II7102-601","UK 4.5","TRUE"],["II7102-601","UK 5","TRUE"],["II7102-601","UK 5.5","TRUE"],["II7102-601","UK 6","TRUE"],["II7102-601","UK 6.5","TRUE"],["II7102-601","UK 7","TRUE"],["II7102-601","UK 7.5","TRUE"],["IB6560-109","UK 2.5","TRUE"],["IB6560-109","UK 3","TRUE"],["IB6560-109","UK 3.5","TRUE"],["IB6560-109","UK 4","TRUE"],["IB6560-109","UK 4.5","TRUE"],["IB6560-109","UK 5","TRUE"],["IB6560-109","UK 5.5","TRUE"],["IB6560-109","UK 6","TRUE"],["IB6560-109","UK 6.5","TRUE"],["IB6560-109","UK 7.5","TRUE"]];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/PreorderConfig!A1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });

  return res.json({ ok: true, rows: rows.length - 1 + ' sizes written' });
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${encode(header)}.${encode(payload)}`;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}
