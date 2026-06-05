import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  console.log('CALLBACK BODY:', JSON.stringify(req.body));

  const bill_id = req.body?.['billplz[id]'] || req.body?.id;
  const paid = req.body?.['billplz[paid]'] || req.body?.paid;

  if (paid !== 'true' && paid !== true) {
    return res.redirect(302, '/?payment=failed');
  }

  try {
    const SANDBOX = process.env.BILLPLZ_SANDBOX === 'true';
    const BASE = SANDBOX
      ? 'https://www.billplz-sandbox.com/api/v3/bills'
      : 'https://www.billplz.com/api/v3/bills';

    const credentials = Buffer.from(`${process.env.BILLPLZ_API_KEY}:`).toString('base64');
    const billRes = await fetch(`${BASE}/${bill_id}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    const bill = await billRes.json();

    const description = bill.description || '';
    const items = parseDescription(description);

    await Promise.all([
      items.length > 0 ? updateInventory(items) : Promise.resolve(),
      sendOrderEmail(bill, description),
    ]);

    return res.redirect(302, '/?payment=success');
  } catch (error) {
    console.error('Error:', error.message);
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

async function sendOrderEmail(bill, description) {
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_PASS;
  if (!EMAIL_USER || !EMAIL_PASS) return;

  const amount = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  await transporter.sendMail({
    from: `"KICKLAB" <${EMAIL_USER}>`,
    to: EMAIL_USER,
    subject: `🎉 New Order - RM${amount} | ${bill.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#1A1A2E;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">KICK<span style="color:#E63946">LAB</span></h1>
          <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:14px">New Order Received!</p>
        </div>
        <div style="padding:24px;background:#f8f8f8">
          <div style="background:#fff;border-radius:8px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;font-size:14px;color:#999;letter-spacing:1px">ORDER AMOUNT</h3>
            <p style="font-size:32px;font-weight:700;color:#E63946;margin:0">RM${amount}</p>
            <p style="font-size:12px;color:#999;margin:4px 0 0">${new Date().toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})}</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;font-size:14px;color:#999;letter-spacing:1px">CUSTOMER</h3>
            <p style="margin:0 0 4px;font-size:14px"><strong>${bill.name}</strong></p>
            <p style="margin:0 0 4px;font-size:13px;color:#666">📱 ${bill.mobile}</p>
            <p style="margin:0;font-size:13px;color:#666">✉️ ${bill.email}</p>
          </div>
          <div style="background:#fff;border-radius:8px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;font-size:14px;color:#999;letter-spacing:1px">ITEMS</h3>
            <p style="margin:0;font-size:13px;color:#444;line-height:1.6">${description.replace(/\|/g,'<br>').replace(/, /g,'<br>')}</p>
          </div>
          <div style="text-align:center;padding-top:8px">
            <p style="font-size:12px;color:#999">Bill ID: ${bill.id}</p>
          </div>
        </div>
      </div>
    `,
  });

  console.log('Order email sent to', EMAIL_USER);
}

async function updateInventory(items) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);

  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:C`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];

  const updates = [];
  for (const item of items) {
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, stock] = rows[i];
      if (sku === item.sku && size === item.size) {
        const newStock = Math.max(0, parseInt(stock) - item.qty);
        updates.push({ range: `Sheet1!C${i + 1}`, values: [[newStock]] });
      }
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
