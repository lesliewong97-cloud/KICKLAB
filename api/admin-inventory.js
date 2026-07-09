export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, action, items } = req.body || {};
  if (password !== 'Kicklab1234@') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (action === 'ping') {
    return res.status(200).json({ ok: true, version: 'setprice-v1' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }

  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const token = await getAccessToken(serviceAccount);

    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await readRes.json();
    const rows = data.values || [];
    const norm = (s) => String(s == null ? '' : s).replace(/^UK\s*/i, '').trim();

    // ---- REBUILD: replace ALL data rows (keep header) with the provided rows ----
    if (action === 'rebuild') {
      // de-dup within batch by sku + normalized size (last one wins)
      const map = new Map();
      for (const item of items) {
        const key = String(item.sku).trim() + '|' + norm(item.size);
        const full = parseInt(item.full) || 0;
        const half = parseInt(item.half) || 0;
        map.set(key, [item.sku, item.size, full, half, full + half]);
      }
      const newRows = [...map.values()];
      // clear existing data rows (keep row 1 header)
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A2:E:clear`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }
      );
      if (newRows.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A2?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: newRows }),
          }
        );
      }
      return res.status(200).json({ ok: true, action, rowsWritten: newRows.length, dedupedFrom: items.length });
    }

    // ---- SET: set absolute full/half for given sku+size (updates existing row, appends if new) ----
    if (action === 'set') {
      const updates = [];
      const toAppend = [];
      const results = [];
      for (const item of items) {
        const full = parseInt(item.full) || 0;
        const half = parseInt(item.half) || 0;
        const total = full + half;
        let foundRow = -1;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0] === item.sku && norm(rows[i][1]) === norm(item.size)) { foundRow = i; break; }
        }
        if (foundRow >= 0) {
          const r = foundRow + 1;
          updates.push({ range: `Inventory!C${r}`, values: [[full]] });
          updates.push({ range: `Inventory!D${r}`, values: [[half]] });
          updates.push({ range: `Inventory!E${r}`, values: [[total]] });
          results.push({ sku: item.sku, size: item.size, full, half, total, action: 'updated' });
        } else {
          toAppend.push([item.sku, item.size, full, half, total]);
          results.push({ sku: item.sku, size: item.size, full, half, total, action: 'appended' });
        }
      }
      if (updates.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) }
        );
      }
      if (toAppend.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E:append?valueInputOption=RAW`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: toAppend }) }
        );
      }
      return res.status(200).json({ ok: true, action, results });
    }

    // ---- SET-PRICE: write price into column F for every row whose sku is in the price map ----
    if (action === 'set-price') {
      const priceBySku = {};
      for (const item of items) priceBySku[String(item.sku).trim()] = item.price;
      const updates = [];
      let matched = 0;
      const notFound = new Set(Object.keys(priceBySku));
      for (let i = 1; i < rows.length; i++) {
        const rSku = (rows[i][0] || '').trim();
        if (rSku in priceBySku) {
          updates.push({ range: `Inventory!F${i + 1}`, values: [[priceBySku[rSku]]] });
          matched++;
          notFound.delete(rSku);
        }
      }
      if (updates.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) }
        );
      }
      return res.status(200).json({ ok: true, action, rowsUpdated: matched, skusWithoutRows: [...notFound] });
    }

    // ---- SYNC-ADD: append only rows whose sku+size is NOT already present (never overwrites) ----
    if (action === 'sync-add') {
      const existing = new Set();
      for (let i = 1; i < rows.length; i++) {
        const [rSku, rSize] = rows[i];
        if (rSku) existing.add(rSku.trim() + '|' + norm(rSize));
      }
      const toAppend = [];
      const added = [], skipped = [];
      for (const item of items) {
        const key = String(item.sku).trim() + '|' + norm(item.size);
        if (existing.has(key)) { skipped.push(item.sku + ' ' + item.size); continue; }
        existing.add(key); // avoid dup within this batch
        const full = parseInt(item.full) || 0;
        const half = parseInt(item.half) || 0;
        const total = full + half;
        toAppend.push([item.sku, item.size, full, half, total]);
        added.push(item.sku + ' ' + item.size);
      }
      if (toAppend.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Inventory!A:E:append?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: toAppend }),
          }
        );
      }
      return res.status(200).json({ ok: true, action, addedCount: added.length, skippedCount: skipped.length, added, skipped });
    }

    // ---- DEDUCT (default): subtract qty from total (E) and the box column (C full / D half) ----
    const updates = [];
    const results = [];
    for (const item of items) {
      const qty = parseInt(item.qty) || 1;
      let matched = false;
      for (let i = 1; i < rows.length; i++) {
        const [rSku, rSize, fullBox, halfBox, stock] = rows[i];
        if (rSku === item.sku && norm(rSize) === norm(item.size)) {
          matched = true;
          const newStock = Math.max(0, parseInt(stock || 0) - qty);
          updates.push({ range: `Inventory!E${i + 1}`, values: [[newStock]] });
          if (item.box === 'half') {
            const newHalf = Math.max(0, parseInt(halfBox || 0) - qty);
            updates.push({ range: `Inventory!D${i + 1}`, values: [[newHalf]] });
            results.push({ sku: item.sku, size: item.size, box: 'half', qty, newHalf, newStock });
          } else {
            const newFull = Math.max(0, parseInt(fullBox || 0) - qty);
            updates.push({ range: `Inventory!C${i + 1}`, values: [[newFull]] });
            results.push({ sku: item.sku, size: item.size, box: 'full', qty, newFull, newStock });
          }
          break;
        }
      }
      if (!matched) results.push({ sku: item.sku, size: item.size, qty, error: 'Row not found' });
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
    return res.status(200).json({ ok: true, action: 'deduct', results });
  } catch (error) {
    console.error('admin-inventory error:', error.message);
    return res.status(500).json({ error: 'Failed to update inventory' });
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
