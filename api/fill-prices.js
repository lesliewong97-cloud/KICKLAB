export default async function handler(req, res) {
  const skuPrices = {"DV0833-102":199,"FD6574-104":180,"FD6575-104":180,"HV1474-200":160,"FJ4151-004":299,"HF5441-107":229,"A02755C":99,"M990GG3":529,"IB2263-100":279,"FN8361-100":280,"FJ3458-160":279,"DN3707-010":519,"IB5841-800":219,"HF4292-200":279,"HF3145-001":279,"DV3950-001":179,"FD5810-101":189,"DM0825-103":149,"HF5388-100":199,"DM0029-014":199,"FJ6869-104":149,"IB0018-100":349,"DZ5485-106":399,"CU4111-002":279,"DV3887-400":199,"DV0821-001":189,"HF4798-100":149,"DH7004-701":199,"DH7004-600":199,"DH7004-100":199,"DJ6377-100":179,"DQ3698-141":239,"440889-141":89,"DD9404-800":99,"DM1051-400":99,"DH9765-200":109,"DZ5224-300":129,"DH4403-700":119,"DX2663-001":129,"DJ4643-070":99,"DR5540-001":129,"629993-103":119,"DH3718-105":119,"DQ4071-100":189,"DD3359-001":129,"CW1588-601":109,"FN6969-025":109,"DH9756-105":109,"DQ8799-100":129,"DD1391-400":219,"DR9705-100":259,"FB8894-002":279,"DD1399-400":189,"DQ8581-100":209,"DD1399-401":219,"DD1391-100":249};

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  const readRes = await fetch(
    ,
    { headers: { Authorization:  } }
  );
  const data = await readRes.json();
  const rows = data.values || [];

  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const sku = rows[i][0];
    const price = skuPrices[sku];
    if (price !== undefined) {
      updates.push({ range: , values: [[price]] });
    }
  }

  if (updates.length > 0) {
    await fetch(
      ,
      {
        method: 'POST',
        headers: { Authorization: , 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      }
    );
  }

  return res.status(200).json({ filled: updates.length, message: 'Done' });
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
  const unsignedToken = ;
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = ;
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