export default async function handler(req, res) {
  const { billplz } = req.body || req.query;

  // Billplz sends callback as form data
  const bill_id = req.body?.['billplz[id]'] || req.query?.['billplz[id]'];
  const paid = req.body?.['billplz[paid]'] || req.query?.['billplz[paid]'];
  const paid_amount = req.body?.['billplz[paid_amount]'] || req.query?.['billplz[paid_amount]'];

  if (paid === 'true') {
    // Payment successful - you can log this or update inventory here
    console.log(`Payment successful: Bill ${bill_id}, Amount: RM${paid_amount / 100}`);

    // Redirect to success page
    return res.redirect(302, '/?payment=success');
  } else {
    // Payment failed or cancelled
    return res.redirect(302, '/?payment=failed');
  }
}
