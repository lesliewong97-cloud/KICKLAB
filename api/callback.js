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

    if (description.startsWith('PREORDER')) {
      const orderNum = (description.match(/ORDER:([A-Z0-9]+)/) || [])[1] || 'N/A';
      const eta = (description.match(/ETA:([^|]+)/) || [])[1]?.trim() || '';
      const price = (description.match(/PRICE:([\d.]+)/) || [])[1] || '0';
      const address = (description.match(/Alamat: ([^|]+)/) || [])[1]?.trim() || '';
      const itemPart = (description.match(/\|\s*(.+?\([A-Z0-9-]+\)\s*UK[\d.]+)\s*\|/) || [])[1]?.trim() || '';
      const skuMatch = itemPart.match(/\(([A-Z0-9-]+)\)/);
      const sizeMatch = itemPart.match(/UK\s?[\d.]+/i);
      const sku = skuMatch ? skuMatch[1] : '';
      const size = sizeMatch ? sizeMatch[0] : '';
      const productName = itemPart.replace(/\([A-Z0-9-]+\).*/, '').trim();
      const deposit = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);

      await recordPreorder({ orderNum, bill, sku, productName, size, deposit, price, address, eta });
      sendPreorderEmail({ orderNum, bill, sku, productName, size, deposit, address, eta }).catch(e => console.error('Preorder email error:', e.message));

      return res.redirect(302, '/?payment=success');
    }

    if (description.startsWith('BALANCE')) {
      const orderNum = (description.match(/ORDER:([A-Z0-9]+)/) || [])[1] || 'N/A';
      const amount = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);

      await markPreorderPaid(orderNum);
      sendBalancePaidEmail({ orderNum, bill, amount }).catch(e => console.error('Balance email error:', e.message));

      return res.redirect(302, '/?payment=success');
    }

    const orderNum = (description.match(/ORDER:([A-Z0-9]+)/) || [])[1] || 'N/A';
    const discountCode = (description.match(/DISCOUNT:([A-Z0-9]+)/) || [])[1] || '';
    console.log('Parsed orderNum:', orderNum);

    // Items, address, and shipping come from Google Sheets
    // (Billplz description only stores ORDER number, not item details)
    const orderData = await getOrderFromSheet(orderNum);
    const items = orderData.items || [];
    const address = orderData.address || '';
    const shippingFee = String(orderData.shipping || '0');
    console.log('Items from sheet:', JSON.stringify(items));

    // Critical ops first — must succeed regardless of email
    await Promise.all([
      items.length > 0 ? updateInventory(items) : Promise.resolve(),
      markOrderPaid(orderNum),
      discountCode ? incrementDiscountUsage(discountCode) : Promise.resolve(),
    ]);

    // Await emails before redirect so they complete before serverless shuts down
    await Promise.allSettled([
      sendOrderEmail(bill, orderNum, address, shippingFee, items),
      bill.email ? sendCustomerEmail(bill, orderNum, address, shippingFee, items) : Promise.resolve(),
    ]);

    return res.redirect(302, '/?payment=success');
  } catch (error) {
    console.error('Error:', error.message);
    return res.redirect(302, '/?payment=success');
  }
}

async function getOrderFromSheet(orderNum) {
  if (!orderNum || orderNum === 'N/A') return {};
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Orders!A:L`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === orderNum) {
      let items = [];
      try { items = JSON.parse(rows[i][6] || '[]'); } catch (e) { console.error('Failed to parse items JSON:', e.message); }
      return {
        items,
        address: rows[i][5] || '',
        shipping: rows[i][8] || '0',
      };
    }
  }
  console.error('Order not found in sheet:', orderNum);
  return {};
}

async function sendOrderEmail(bill, orderNum, address, shippingFee, items) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;

  const amount = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);
  const subtotal = (parseFloat(amount) - parseFloat(shippingFee)).toFixed(2);

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
        <p style="margin:0;font-size:13px;font-weight:600;color:#1A1A2E">👟 ${item.name || item.sku}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#888">${item.size}${item.box ? ' · ' + (item.box === 'half' ? 'Half Box' : 'Full Box') : ''} · Qty: ${item.qty}</p>
      </td>
    </tr>
  `).join('');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'KICKLAB <noreply@kicklab.com.my>',
      to: ['lesliewong97@gmail.com'],
      subject: `🎉 New Order #${orderNum} - RM${amount} | ${bill.name}`,
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
<div style="background:#1A1A2E;padding:28px 32px;text-align:center">
<h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px">KICK<span style="color:#E63946">LAB</span></h1>
<p style="color:rgba(255,255,255,0.5);margin:6px 0 0;font-size:13px;letter-spacing:1px">NEW ORDER RECEIVED</p>
</div>
<div style="background:#E63946;padding:20px 32px">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">ORDER NUMBER</p>
<p style="color:#fff;margin:0;font-size:22px;font-weight:700">#${orderNum}</p></td>
<td style="text-align:right"><p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">TOTAL</p>
<p style="color:#fff;margin:0;font-size:28px;font-weight:700">RM${amount}</p></td>
</tr></table>
</div>
<div style="padding:28px 32px">
<div style="margin-bottom:24px">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">CUSTOMER</p>
<div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1A1A2E">${bill.name}</p>
<p style="margin:0 0 3px;font-size:13px;color:#666">📱 ${bill.mobile}</p>
<p style="margin:0;font-size:13px;color:#666">✉️ ${bill.email}</p>
</div>
</div>
<div style="margin-bottom:24px">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">ITEMS ORDERED</p>
<div style="background:#f8f8f8;border-radius:8px;padding:4px 16px">
<table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
</div>
</div>
<div style="margin-bottom:24px">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">SHIPPING ADDRESS</p>
<div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
<p style="margin:0;font-size:13px;color:#555;line-height:1.7">📍 ${address || 'Not provided'}</p>
</div>
</div>
<div style="border-top:2px solid #f0f0f0;padding-top:16px">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;color:#888;padding-bottom:6px">Subtotal</td>
<td style="text-align:right;font-size:13px;color:#888;padding-bottom:6px">RM${subtotal}</td></tr>
<tr><td style="font-size:13px;color:#888;padding-bottom:10px">Shipping (J&T)</td>
<td style="text-align:right;font-size:13px;color:#888;padding-bottom:10px">RM${shippingFee}</td></tr>
<tr><td style="font-size:15px;font-weight:700;color:#1A1A2E">Total Paid</td>
<td style="text-align:right;font-size:20px;font-weight:700;color:#E63946">RM${amount}</td></tr>
</table>
</div>
<p style="text-align:center;font-size:11px;color:#ccc;margin-top:20px">Bill ID: ${bill.id}</p>
</div>
<div style="background:#f8f8f8;padding:16px 32px;text-align:center">
<p style="margin:0;font-size:12px;color:#aaa">KICKLAB · kicklab.com.my</p>
</div>
</div>
</body></html>`,
    }),
  });
}

async function sendCustomerEmail(bill, orderNum, address, shippingFee, items) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY || !bill.email) return;

  const amount = (parseInt(bill.paid_amount || bill.amount) / 100).toFixed(2);
  const subtotal = (parseFloat(amount) - parseFloat(shippingFee)).toFixed(2);

  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
        <p style="margin:0;font-size:13px;font-weight:600;color:#1A1A2E">👟 ${item.name || item.sku}</p>
        <p style="margin:2px 0 0;font-size:12px;color:#888">${item.size}${item.box ? ' · ' + (item.box === 'half' ? 'Half Box' : 'Full Box') : ''} · Qty: ${item.qty}</p>
      </td>
    </tr>
  `).join('');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'KICKLAB <noreply@kicklab.com.my>',
      to: [bill.email],
      subject: `✅ Order Confirmed #${orderNum} - Thank you, ${bill.name}!`,
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
<div style="background:#1A1A2E;padding:28px 32px;text-align:center">
<h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px">KICK<span style="color:#E63946">LAB</span></h1>
<p style="color:rgba(255,255,255,0.5);margin:6px 0 0;font-size:13px;letter-spacing:1px">ORDER CONFIRMED</p>
</div>
<div style="background:#1A1A2E;padding:20px 32px;border-top:2px solid #E63946">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">ORDER NUMBER</p>
<p style="color:#fff;margin:0;font-size:22px;font-weight:700">#${orderNum}</p></td>
<td style="text-align:right"><p style="color:rgba(255,255,255,0.8);margin:0 0 2px;font-size:11px;letter-spacing:1px">TOTAL PAID</p>
<p style="color:#E63946;margin:0;font-size:28px;font-weight:700">RM${amount}</p></td>
</tr></table>
</div>
<div style="padding:28px 32px">
<p style="font-size:16px;color:#1A1A2E;font-weight:600;margin:0 0 6px">Hi ${bill.name}! 👋</p>
<p style="font-size:14px;color:#555;margin:0 0 24px;line-height:1.6">Your order has been confirmed and payment received. We'll pack your kicks and update you once they're on the way!</p>
<div style="margin-bottom:24px">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">ITEMS ORDERED</p>
<div style="background:#f8f8f8;border-radius:8px;padding:4px 16px">
<table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
</div>
</div>
<div style="margin-bottom:24px">
<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#aaa">SHIPPING TO</p>
<div style="background:#f8f8f8;border-radius:8px;padding:14px 16px">
<p style="margin:0;font-size:13px;color:#555;line-height:1.7">📍 ${address || 'Not provided'}</p>
</div>
</div>
<div style="border-top:2px solid #f0f0f0;padding-top:16px">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;color:#888;padding-bottom:6px">Subtotal</td>
<td style="text-align:right;font-size:13px;color:#888;padding-bottom:6px">RM${subtotal}</td></tr>
<tr><td style="font-size:13px;color:#888;padding-bottom:10px">Shipping (J&T)</td>
<td style="text-align:right;font-size:13px;color:#888;padding-bottom:10px">RM${shippingFee}</td></tr>
<tr><td style="font-size:15px;font-weight:700;color:#1A1A2E">Total Paid</td>
<td style="text-align:right;font-size:20px;font-weight:700;color:#E63946">RM${amount}</td></tr>
</table>
</div>
<div style="background:#f0f9f0;border-radius:8px;padding:16px;margin-top:20px;text-align:center">
<p style="margin:0;font-size:13px;color:#2ecc71;font-weight:700">✅ Payment Received — Thank You!</p>
<p style="margin:4px 0 0;font-size:12px;color:#888">Questions? Contact us at kicklab.com.my</p>
</div>
</div>
<div style="background:#f8f8f8;padding:16px 32px;text-align:center">
<p style="margin:0;font-size:12px;color:#aaa">KICKLAB · kicklab.com.my</p>
</div>
</div>
</body></html>`,
    }),
  });
}

async function sendPreorderEmail({ orderNum, bill, sku, productName, size, deposit, address, eta }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'KICKLAB <noreply@kicklab.com.my>',
      to: ['lesliewong97@gmail.com'],
      subject: `🎉 New Preorder #${orderNum} - RM${deposit} deposit | ${bill.name}`,
      html: `<p>Preorder #${orderNum} from ${bill.name} — ${productName} (${sku}) ${size} — Deposit RM${deposit} — ETA: ${eta}</p>`,
    }),
  });
}

async function sendBalancePaidEmail({ orderNum, bill, amount }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'KICKLAB <noreply@kicklab.com.my>',
      to: ['lesliewong97@gmail.com'],
      subject: `✅ Balance Paid #${orderNum} - RM${amount} | ${bill.name}`,
      html: `<p>Balance paid for preorder #${orderNum} from ${bill.name} — RM${amount} received.</p>`,
    }),
  });
}

async function recordPreorder({ orderNum, bill, sku, productName, size, deposit, price, address, eta }) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const timestamp = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!A:M:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[timestamp, orderNum, bill.name, bill.mobile, bill.email, sku, productName, size, deposit, price, address, eta, 'Pending Arrival']] }),
    }
  );
}

async function markPreorderPaid(orderNum) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!A:M`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === orderNum) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Preorder!M${i + 1}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Paid - Ready to Ship']] }),
        }
      );
      return;
    }
  }
}

async function markOrderPaid(orderNum) {
  if (!orderNum || orderNum === 'N/A') return;
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Orders!A:L`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === orderNum) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Orders!L${i + 1}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Paid']] }),
        }
      );
      return;
    }
  }
}

async function incrementDiscountUsage(code) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/DiscountCodes!A:F`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').trim().toUpperCase() === code.trim().toUpperCase()) {
      const used = parseInt(rows[i][4] || '0') + 1;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/DiscountCodes!E${i + 1}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[used]] }),
        }
      );
      return;
    }
  }
}

async function updateInventory(items) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const token = await getAccessToken(serviceAccount);
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await readRes.json();
  const rows = data.values || [];
  const updates = [];
  for (const item of items) {
    for (let i = 1; i < rows.length; i++) {
      const [sku, size, fullBox, halfBox, stock] = rows[i];
      const norm = s => String(s == null ? '' : s).replace(/^UK\s*/i, '').trim();
      if (sku === item.sku && norm(size) === norm(item.size)) {
        const newStock = Math.max(0, parseInt(stock || 0) - item.qty);
        updates.push({ range: `Inventory!E${i + 1}`, values: [[newStock]] });
        if (item.box === 'half') {
          const newHalf = Math.max(0, parseInt(halfBox || 0) - item.qty);
          updates.push({ range: `Inventory!D${i + 1}`, values: [[newHalf]] });
        } else {
          const newFull = Math.max(0, parseInt(fullBox || 0) - item.qty);
          updates.push({ range: `Inventory!C${i + 1}`, values: [[newFull]] });
        }
        break;
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
