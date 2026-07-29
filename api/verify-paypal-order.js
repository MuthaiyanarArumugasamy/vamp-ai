// Vercel serverless function.
// Verifies a PayPal order was actually captured and paid for the expected
// amount, using your PayPal Client ID + Secret server-side. The Secret is
// read from an environment variable — it must NEVER appear in the browser code.
//
// Set these in your Vercel project settings (Settings -> Environment Variables):
//   PAYPAL_CLIENT_ID  = your PayPal Client ID (the same one used in vamp-ai.html)
//   PAYPAL_SECRET     = your PayPal Client Secret (from the same app in the PayPal
//                       Developer dashboard — keep this private, never in frontend code)
//   PAYPAL_API_BASE   = https://api-m.paypal.com        (for live payments)
//                       https://api-m.sandbox.paypal.com (for sandbox testing)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ verified: false, error: 'Method not allowed' });
  }

  const { orderId, expectedAmount } = req.body || {};
  if (!orderId || !expectedAmount) {
    return res.status(400).json({ verified: false, error: 'Missing orderId or expectedAmount' });
  }

  const base = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!clientId || !secret) {
    return res.status(500).json({ verified: false, error: 'Server is missing PayPal credentials' });
  }

  try {
    // 1. Get an access token
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    if (!tokenRes.ok) throw new Error('Could not authenticate with PayPal');
    const tokenData = await tokenRes.json();

    // 2. Look up the order directly from PayPal's servers (not from the browser)
    const orderRes = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!orderRes.ok) throw new Error('Could not fetch order from PayPal');
    const order = await orderRes.json();

    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
    const status = capture?.status;
    const paidAmount = parseFloat(capture?.amount?.value || '0');

    const verified = status === 'COMPLETED' && paidAmount >= parseFloat(expectedAmount) - 0.01;

    return res.status(200).json({ verified, status, paidAmount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ verified: false, error: 'Verification failed' });
  }
}
