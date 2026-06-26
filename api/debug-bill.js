export default async function handler(req, res) {
  const bill_id = req.query.bill_id || '9d111431b6edabbf';
  const SANDBOX = process.env.BILLPLZ_SANDBOX === 'true';
  const BASE = SANDBOX
    ? 'https://www.billplz-sandbox.com/api/v3/bills'
    : 'https://www.billplz.com/api/v3/bills';
  const credentials = Buffer.from(`${process.env.BILLPLZ_API_KEY}:`).toString('base64');
  const r = await fetch(`${BASE}/${bill_id}`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const bill = await r.json();
  return res.json({
    bill_id,
    status: r.status,
    description: bill.description,
    paid_amount: bill.paid_amount,
    paid: bill.paid,
    name: bill.name,
    email: bill.email,
    raw: bill,
  });
}
