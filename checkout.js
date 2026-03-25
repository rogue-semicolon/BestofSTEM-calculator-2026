import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { totalAmount, entries, discountApplied, discountCodes, products } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_creation: 'always',
      custom_fields: [
        {
          key: 'company_name',
          label: { type: 'custom', custom: 'Company name' },
          type: 'text'
        }
      ],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(totalAmount * 100),
            product_data: {
              name: 'Best of STEM Awards 2026',
              description: `${entries} categor${entries === 1 ? 'y' : 'ies'} across ${products.length} product${products.length === 1 ? '' : 's'}`
            }
          },
          quantity: 1
        }
      ],
      metadata: {
        products: JSON.stringify(products),
        entries: String(entries),
        discountCodes: Array.isArray(discountCodes) ? discountCodes.join(',') : (discountCodes || ''),
        discountApplied: String(discountApplied)
      },
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://bestof-stem-calculator-2026.vercel.app/'
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
}
