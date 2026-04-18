import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { totalAmount, entries, discountApplied, discountCodes, products } = req.body;import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---- Pricing & discount rules (source of truth) ----
const EARL_DEADLINE = new Date('2026-05-05T23:59:59');

const CODES = {
  'EARLE.BYRD2026': { amount: 100, isEarl: true },
  'KEHLUV2026':     { amount: 100, isEarl: false },
  '2026AWARDS':     { amount: 50,  isEarl: false },
  'DOLS2026':       { amount: 50,  isEarl: false }
};

function normalizeCode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // Strip all whitespace and uppercase — lets "EARL E. BYRD 2026" match "EARLE.BYRD2026"
  return raw.replace(/\s+/g, '').toUpperCase();
}

function getUnitPrice(totalEntries) {
  if (totalEntries <= 0) return 0;
  if (totalEntries === 1) return 745;
  if (totalEntries <= 4) return 625;
  return 575;
}

function getBaseTotal(totalEntries) {
  if (totalEntries === 0) return 0;
  if (totalEntries === 1) return 745;
  return totalEntries * getUnitPrice(totalEntries);
}

function computeDiscount(rawCodes, now = new Date()) {
  const normalized = (Array.isArray(rawCodes) ? rawCodes : [])
    .map(normalizeCode)
    .filter(Boolean);

  // Dedupe — two variants of the same code (e.g. both Earl spellings) count once.
  const unique = [...new Set(normalized)];

  const validated = unique
    .map(code => {
      const entry = CODES[code];
      if (!entry) return null;
      if (entry.isEarl && now > EARL_DEADLINE) return null;
      return { code, ...entry };
    })
    .filter(Boolean);

  if (validated.length === 0) return { discount: 0, appliedCodes: [] };

  if (validated.length === 1) {
    return { discount: validated[0].amount, appliedCodes: [validated[0].code] };
  }

  // Two codes — enforce combo rules.
  const earlCount = validated.filter(v => v.isEarl).length;

  // Two Earl codes: not allowed. Two standard codes: not allowed.
  if (earlCount !== 1) {
    // Fall back to the single best code rather than failing the whole checkout.
    const best = validated.reduce((a, b) => (a.amount >= b.amount ? a : b));
    return { discount: best.amount, appliedCodes: [best.code] };
  }

  // Exactly one Earl + one standard — allowed.
  return {
    discount: validated.reduce((sum, v) => sum + v.amount, 0),
    appliedCodes: validated.map(v => v.code)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { products, discountCodes } = req.body || {};

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'No products provided' });
  }

  // Sanitize — ignore anything the client didn't populate correctly.
  const cleanProducts = products
    .map(p => ({
      name: String(p?.name || '').trim(),
      categories: Array.isArray(p?.categories)
        ? p.categories.filter(c => typeof c === 'string' && c.trim().length > 0)
        : []
    }))
    .filter(p => p.name && p.categories.length > 0);

  if (cleanProducts.length === 0) {
    return res.status(400).json({ error: 'No valid products with categories' });
  }

  const totalEntries = cleanProducts.reduce((sum, p) => sum + p.categories.length, 0);
  if (totalEntries === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  // Server-computed, client-untrusted:
  const baseTotal = getBaseTotal(totalEntries);
  const { discount, appliedCodes } = computeDiscount(discountCodes);
  const finalTotal = Math.max(0, baseTotal - discount);

  if (finalTotal < 0.50) {
    return res.status(400).json({ error: 'Total below minimum charge' });
  }

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
            unit_amount: Math.round(finalTotal * 100),
            product_data: {
              name: 'Best of STEM Awards 2026',
              description: `${totalEntries} categor${totalEntries === 1 ? 'y' : 'ies'} across ${cleanProducts.length} product${cleanProducts.length === 1 ? '' : 's'}`
            }
          },
          quantity: 1
        }
      ],
      metadata: {
        products: JSON.stringify(cleanProducts),
        entries: String(totalEntries),
        discountCodes: appliedCodes.join(','),
        discountApplied: String(discount)
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
