export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, amount, items, address, shipping, orderNum, redirect_url } = req.body;

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
    `${i.name} UK${i.size ? i.size.replace('UK ','') : 'N/A'} (${i.sku}) [${i.box === 'half' ? 'Half Box' : 'Full Box'}] x${i.qty}`
  ).join(', ');

  const description = [
    orderNum ? `ORDER:${orderNum}` : '',
    itemsDesc,
    address ? `Alamat: ${address}` : '',
    shipping ? `Shipping: RM${shipping}` : '',
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

    return res.status(200).json({
      bill_id: data.id,
      payment_url: data.url,
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to create bill' });
  }
}
