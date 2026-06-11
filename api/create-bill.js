export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, amount, items, address, shipping, orderNum, redirect_url, discountCode } = req.body;

  const BILLPLZ_API_KEY = process.env.BILLPLZ_API_KEY;
  const BILLPLZ_COLLECTION_ID = process.env.BILLPLZ_COLLECTION_ID;
  const SANDBOX = process.env.BILLPLZ_SANDBOX === 'true';

  const BASE_URL = SANDBOX
    ? 'https://www.billplz-sandbox.com/api/v3/bills'
    : 'https://www.billplz.com/api/v3/bills';

  if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const itemsDesc = items.map(i =>
    `${i.isPreorder ? 'PREORDER ' : ''}${i.name} UK${i.size ? i.size.replace('UK ','') : 'N/A'} (${i.sku})${i.isPreorder ? ` ETA:${i.eta}` : ` [${i.box === 'half' ? 'Half Box' : 'Full Box'}]`} x${i.qty}`
  ).join(', ');

  const description = [
    orderNum ? `ORDER:${orderNum}` : '',
    itemsDesc,
    address ? `Alamat: ${address}` : '',
    shipping ? `Shipping: RM${shipping}` : '',
    discountCode ? `DISCOUNT:${discountCode}` : '',
  ].filter(Boolean).join(' | ');

  try {
    const credentials = Buffer.from(`${BILLPLZ_API_KEY}:`).toString('base64');
    const callbackUrl = `https://kicklab-nu.vercel.app/api/callback`;

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        collection_id: BILLPLZ_COLLECTION_ID,
        email: email || 'noreply@kicklab.com',
        mobile: phone || '',
        name: name,
        amount: String(Math.round(amount * 100)),
        description: description,
        callback_url: callbackUrl,
        redirect_url: (redirect_url || 'https://kicklab-nu.vercel.app') + '?payment=success',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: data });
    }

    try {
      await recordOrder({ orderNum, name, phone, email, address, items, amount, shipping, billId: data.id });
    } catch (e) {
      console.error('Failed to record order:', e.message);
    }

    return res.status(200).json({
      bill_id: data.id,
      payment_url: data.url,
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to create bill' });
  }
}

async function recordOrder({ orderNum, name, phone, email, address, items, amount, shipping, billId }) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  const SHEET_NAME = 'Orders';
  const HEADERS = ['Timestamp','OrderNum','Name','Phone','Email','Address','Items','Subtotal','Shipping','Total','BillID','Status'];

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
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A1:L1?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADERS] }),
      }
    );
  }

  const timestamp = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
  const shippingFee = shipping || 0;
  const subtotal = (parseFloat(amount) - parseFloat(shippingFee)).toFixed(2);

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A:L:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [[
          timestamp, orderNum || '', name || '', phone || '', email || '', address || '',
          JSON.stringify(items || []), subtotal, shippingFee, amount, billId || '', 'Pending Payment'
        ]],
      }),
    }
  );
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
