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
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    
    <!-- Header -->
    <div style="background:#1A1A2E;padding:28px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px">KICK<span style="color:#E63946">LAB</span></h1>
      <p style="color:rgba(255,255,255,0.5);margin:6px 0 0;font-size:13px;letter-spacing:1px">NEW ORDER RECEIVED</p>
    </div>

    <!-- Amount Banner -->
    <div style="background:#E63946;padding:20px 32px;text-align:center">
      <p style="color:rgba(255,255,255,0.8);margin:0 0 4px;font-size:12px;letter-spacing:1px">TOTAL AMOUNT</p>
      <p style="color:#fff;margin:0;font-size:38px;font-weight:700">RM${amount}</p>
      <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px">${new Date().toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
    </div>

    <div style="padding:28px 32px">

      <!-- Customer -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">CUSTOMER DETAILS</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:16px">
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#1A1A2E">${bill.name}</p>
          <p style="margin:0 0 4px;font-size:13px;color:#666">📱 ${bill.mobile}</p>
          <p style="margin:0;font-size:13px;color:#666">✉️ ${bill.email}</p>
        </div>
      </div>

      <!-- Items -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">ITEMS ORDERED</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:16px">
          ${description.split(', ').filter(i=>!i.startsWith('Alamat')).map(item=>`
            <p style="margin:0 0 6px;font-size:13px;color:#333;padding-bottom:6px;border-bottom:1px solid #eee">👟 ${item}</p>
          `).join('')}
        </div>
      </div>

      <!-- Address -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">SHIPPING ADDRESS</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:16px">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.7">📍 ${description.split('Alamat: ')[1] || 'Not provided'}</p>
        </div>
      </div>

      <!-- Bill ID -->
      <div style="text-align:center;padding-top:8px;border-top:1px solid #f0f0f0">
        <p style="margin:12px 0 0;font-size:11px;color:#bbb">Bill ID: ${bill.id}</p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#f8f8f8;padding:16px 32px;text-align:center">
      <p style="margin:0;font-size:12px;color:#aaa">KICKLAB · kicklab.com.my</p>
    </div>

  </div>
</body>
</html>
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
