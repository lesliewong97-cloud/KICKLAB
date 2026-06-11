import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = 'Kicklab1234@';
const SHEET_NAME = 'Orders';
const HEADERS = ['Timestamp','OrderNum','Name','Phone','Email','Address','Items','Subtotal','Shipping','Total','BillID','Status'];

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
      const rows = await readSheet(sheetId, token);
      const orders = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[1]) continue;
        if ((r[11] || '') === 'Pending Payment') continue;
        let items = [];
        try { items = JSON.parse(r[6] || '[]'); } catch (e) {}
        orders.push({
          row: i + 1,
          timestamp: r[0] || '',
          orderNum: r[1] || '',
          name: r[2] || '',
          phone: r[3] || '',
          email: r[4] || '',
          address: r[5] || '',
          items,
          subtotal: r[7] || '',
          shipping: r[8] || '',
          total: r[9] || '',
          billId: r[10] || '',
          status: r[11] || '',
        });
      }
      return res.status(200).json({ orders });
    }

    if (action === 'ship') {
      if (!orderNum) return res.status(400).json({ error: 'Missing orderNum' });
      const rows = await readSheet(sheetId, token);
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

      const [, , name, phone, email, address, itemsJson] = order;
      let items = [];
      try { items = JSON.parse(itemsJson || '[]'); } catch (e) {}

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!L${rowIndex}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Shipped']] }),
        }
      );

      if (email) {
        await sendShippedEmail({ email, name, orderNum, items });
      }

      return res.status(200).json({ message: 'Order marked as shipped' });
    }

    if (action === 'init') {
      await ensureSheet(sheetId, token);
      return res.status(200).json({ message: 'ok' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

async function readSheet(sheetId, token) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A:L`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  return d.values || [];
}

async function ensureSheet(sheetId, token) {
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
  }
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${SHEET_NAME}!A1:L1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [HEADERS] }),
    }
  );
}

async function sendShippedEmail({ email, name, orderNum, items }) {
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_PASS = process.env.EMAIL_PASS;
  if (!EMAIL_USER || !EMAIL_PASS) return;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const itemsHtml = (items || []).map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
        <p style="margin:0;font-size:13px;font-weight:600;color:#1A1A2E">👟 ${i.brand ? i.brand + ' ' : ''}${i.name} (${i.sku})</p>
        <p style="margin:2px 0 0;font-size:12px;color:#888">${i.size ? i.size : ''}${i.box ? ' · ' + (i.box === 'half' ? 'Half Box' : 'Full Box') : ''} · Qty: ${i.qty}</p>
      </td>
    </tr>
  `).join('');

  await transporter.sendMail({
    from: `"KICKLAB" <${EMAIL_USER}>`,
    to: email,
    subject: `📦 Your KICKLAB Order #${orderNum} Has Shipped!`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:#1A1A2E;padding:28px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px">KICK<span style="color:#E63946">LAB</span></h1>
      <p style="color:rgba(255,255,255,0.5);margin:6px 0 0;font-size:13px;letter-spacing:1px">YOUR ORDER IS ON ITS WAY</p>
    </div>
    <div style="padding:28px 32px">
      <p style="font-size:14px;color:#333;line-height:1.6">Hi ${name},</p>
      <p style="font-size:14px;color:#333;line-height:1.6">Great news! Your order <strong>#${orderNum}</strong> has been shipped via J&T Express and is on its way to you.</p>

      <div style="margin:20px 0">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">ITEMS SHIPPED</p>
        <div style="background:#f8f8f8;border-radius:8px;padding:4px 16px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
          </table>
        </div>
      </div>

      <p style="font-size:13px;color:#666;line-height:1.6">If you have any questions, feel free to WhatsApp us anytime.</p>
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
