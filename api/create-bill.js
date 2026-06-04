export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, amount, description, redirect_url } = req.body;

  const BILLPLZ_API_KEY = process.env.BILLPLZ_API_KEY;
  const BILLPLZ_COLLECTION_ID = process.env.BILLPLZ_COLLECTION_ID;

  if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const credentials = Buffer.from(`${BILLPLZ_API_KEY}:`).toString('base64');

    const response = await fetch('https://www.billplz.com/api/v3/bills', {
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
        amount: String(Math.round(amount * 100)), // convert to cents
        description: description,
        callback_url: `${process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL : redirect_url}/api/callback`,
        redirect_url: redirect_url,
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
