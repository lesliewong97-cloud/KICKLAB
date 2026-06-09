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
    console.log('Full description:', description);
    const items = parseDescription(description);
    const orderNum = (description.match(/ORDER:([A-Z0-9]+)/) || [])[1] || 'N/A';
    console.log('Parsed orderNum:', orderNum);
    const address = (description.match(/Alamat: ([^|]+)/) || [])[1]?.trim() || '';
    const shippingFee = (description.match(/Shipping: RM([\d.]+)/) || [])[1] || '0';

    await Promise.all([
      items.length > 0 ? updateInventory(items) : Promise.resolve(),
      sendOrderEmail(bill, description, orderNum, address, shippingFee, items),
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

async function sendOrderEmail(bill, description, orderNum, address, shippingFee, items) {
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_PASS;
  if (!EMAIL_USER || !EMAIL_PASS) return;

  const amount = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);
  const subtotal = (parseFloat(amount) - parseFloat(shippingFee)).toFixed(2);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const itemsHtml = items.map(item => {
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
          <p style="margin:0;font-size:13px;font-weight:600;color:#1A1A2E">👟 ${item.sku}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#888">${item.size}${item.box ? ' · ' + (item.box === 'half' ? 'Half Box' : 'Full Box') : ''} · Qty: ${item.qty}</p>
        </td>
      </tr>
    `;
  }).join('');

  await transporter.sendMail({
    from: `"KICKLAB" <${EMAIL_USER}>`,
    to: EMAIL_USER,
    subject: `🎉 New Order #${orderNum} - RM${amount} | ${bill.name}`,
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

    <!-- Order Number + Amount Banner -->
    <div style="background:#E63946;padding:20px 32px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">ORDER NUMBER</p>
            <p style="color:#fff;margin:0;font-size:22px;font-weight:700">#${orderNum}</p>
          </td>
          <td style="text-align:right">
            <p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">TOTAL</p>
            <p style="color:#fff;margin:0;font-size:28px;font-weight:700">RM${amount}</p>
          </td>
        </tr>
      </table>
      <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:12px">${new Date().toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
    </div>

    <div style="padding:28px 32px">

      <!-- Customer -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">CUSTOMER</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A2E">${bill.name}</p>
          <p style="margin:0 0 3px;font-size:13px;color:#666">📱 ${bill.mobile}</p>
          <p style="margin:0;font-size:13px;color:#666">✉️ ${bill.email}</p>
        </div>
      </div>

      <!-- Items -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">ITEMS ORDERED</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:4px 16px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
          </table>
        </div>
      </div>

      <!-- Shipping Address -->
      <div style="margin-bottom:24px">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">SHIPPING ADDRESS</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.7">📍 ${address || 'Not provided'}</p>
        </div>
      </div>

      <!-- Price Breakdown -->
      <div style="border-top:2px solid #f0f0f0;padding-top:16px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#888;padding-bottom:6px">Subtotal</td>
            <td style="text-align:right;font-size:13px;color:#888;padding-bottom:6px">RM${subtotal}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding-bottom:10px">Shipping (J&T)</td>
            <td style="text-align:right;font-size:13px;color:#888;padding-bottom:10px">RM${shippingFee}</td>
          </tr>
          <tr>
            <td style="font-size:15px;font-weight:700;color:#1A1A2E">Total Paid</td>
            <td style="text-align:right;font-size:20px;font-weight:700;color:#E63946">RM${amount}</td>
          </tr>
        </table>
      </div>

      <p style="text-align:center;font-size:11px;color:#ccc;margin-top:20px">Bill ID: ${bill.id}</p>
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
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:E`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];

  const updates = [];
  for (const item of items) {
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, fullBox, halfBox, stock] = rows[i];
      if (sku === item.sku && size === item.size) {
        const newStock = Math.max(0, parseInt(stock || 0) - item.qty);
        updates.push({ range: `Sheet1!E${i + 1}`, values: [[newStock]] });
        if (item.box === 'half') {
          const newHalf = Math.max(0, parseInt(halfBox || 0) - item.qty);
          updates.push({ range: `Sheet1!D${i + 1}`, values: [[newHalf]] });
        } else if (item.box === 'full') {
          const newFull = Math.max(0, parseInt(fullBox || 0) - item.qty);
          updates.push({ range: `Sheet1!C${i + 1}`, values: [[newFull]] });
        }
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
