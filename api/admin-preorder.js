import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = 'Kicklab1234@';

export default async function handler(req, res) {
  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { password, action, orderNum } = body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const token = await getAccessToken(serviceAccount);

    if (action === 'list') {
      const readRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!A:M`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await readRes.json();
      const rows = data.values || [];
      const orders = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[1]) continue;
        orders.push({
          row: i + 1,
          timestamp: r[0] || '',
          orderNum: r[1] || '',
          name: r[2] || '',
          phone: r[3] || '',
          email: r[4] || '',
          sku: r[5] || '',
          product: r[6] || '',
          size: r[7] || '',
          deposit: r[8] || '',
          price: r[9] || '',
          address: r[10] || '',
          eta: r[11] || '',
          status: r[12] || '',
        });
      }
      return res.status(200).json({ orders });
    }

    if (action === 'notify') {
      if (!orderNum) return res.status(400).json({ error: 'Missing orderNum' });

      const readRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!A:M`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await readRes.json();
      const rows = data.values || [];

      let rowIndex = -1;
      let order = null;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] === orderNum) {
          rowIndex = i + 1;
          order = rows[i];
          break;
        }
      }
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const [, , name, phone, email, sku, product, size, depositStr, priceStr, address, eta] = order;
      const deposit = parseFloat(depositStr) || 0;
      const price = parseFloat(priceStr) || 0;

      const isEastMalaysia = /sabah|sarawak|labuan/i.test(address || '');
      const shipping = isEastMalaysia ? 25 : 8;
      const balance = Math.max(0, price - deposit + shipping);

      // Create Billplz balance bill
      const BILLPLZ_API_KEY = process.env.BILLPLZ_API_KEY;
      const BILLPLZ_COLLECTION_ID = process.env.BILLPLZ_COLLECTION_ID;
      const SANDBOX = process.env.BILLPLZ_SANDBOX === 'true';
      const BASE_URL = SANDBOX
        ? 'https://www.billplz-sandbox.com/api/v3/bills'
        : 'https://www.billplz.com/api/v3/bills';

      const description = [
        'BALANCE',
        `ORDER:${orderNum}`,
        `${product} (${sku}) ${size}`,
      ].filter(Boolean).join(' | ');

      const credentials = Buffer.from(`${BILLPLZ_API_KEY}:`).toString('base64');
      const billRes = await fetch(BASE_URL, {
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
          amount: String(Math.round(balance * 100)),
          description,
          callback_url: `https://kicklab-nu.vercel.app/api/callback`,
          redirect_url: `https://kicklab-nu.vercel.app?payment=success`,
        }),
      });
      const billData = await billRes.json();
      if (!billRes.ok) {
        return res.status(400).json({ error: billData });
      }

      // Update sheet status
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!M${rowIndex}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Awaiting Balance Payment']] }),
        }
      );

      // Email customer
      if (email) {
        await sendBalanceNoticeEmail({
          email, name, orderNum, product, sku, size, eta,
          deposit, price, shipping, balance,
          paymentUrl: billData.url,
        });
      }

      return res.status(200).json({
        message: 'Customer notified',
        balance,
        shipping,
        payment_url: billData.url,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

async function sendBalanceNoticeEmail({ email, name, orderNum, product, sku, size, eta, deposit, price, shipping, balance, paymentUrl }) {
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_PASS;
  if (!EMAIL_USER || !EMAIL_PASS) return;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  await transporter.sendMail({
    from: `"KICKLAB" <${EMAIL_USER}>`,
    to: email,
    subject: `📦 Your KICKLAB Preorder Has Arrived! Pay Balance for #${orderNum}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:#1A1A2E;padding:28px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px">KICK<span style="color:#E63946">LAB</span></h1>
      <p style="color:rgba(255,255,255,0.5);margin:6px 0 0;font-size:13px;letter-spacing:1px">YOUR PREORDER HAS ARRIVED</p>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:14px;color:#333;line-height:1.6">Hi ${name},</p>
      <p style="font-size:14px;color:#333;line-height:1.6">Good news! Your preorder item has arrived at our warehouse. Please pay the remaining balance so we can ship it out to you.</p>

      <div style="margin:20px 0">
        <div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A2E">👟 ${product} (${sku})</p>
          <p style="margin:0;font-size:13px;color:#666">Size: ${size} · Order #${orderNum}</p>
        </div>
      </div>

      <div style="border-top:2px solid #f0f0f0;padding-top:16px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#888;padding-bottom:6px">Full Price</td>
            <td style="text-align:right;font-size:13px;color:#888;padding-bottom:6px">RM${price.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding-bottom:6px">Deposit Paid</td>
            <td style="text-align:right;font-size:13px;color:#888;padding-bottom:6px">- RM${deposit.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding-bottom:10px">Shipping (J&T)</td>
            <td style="text-align:right;font-size:13px;color:#888;padding-bottom:10px">+ RM${shipping.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="font-size:15px;font-weight:700;color:#1A1A2E">Balance Due</td>
            <td style="text-align:right;font-size:20px;font-weight:700;color:#E63946">RM${balance.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <div style="text-align:center;margin-top:28px">
        <a href="${paymentUrl}" style="display:inline-block;background:#E63946;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px">Pay Balance RM${balance.toFixed(2)} →</a>
      </div>

      <p style="text-align:center;font-size:12px;color:#aaa;margin-top:24px">Once payment is received, we'll ship your order right away!</p>
    </div>
    <div style="background:#f8f8f8;padding:16px 32px;text-align:center">
      <p style="margin:0;font-size:12px;color:#aaa">KICKLAB · kicklab.com.my</p>
    </div>
  </div>
</body>
</html>
    `,
  });
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
