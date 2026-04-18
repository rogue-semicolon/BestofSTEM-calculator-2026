const Stripe = require('stripe');

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

  // Two+ codes — enforce combo rules.
  const earlCount = validated.filter(v => v.isEarl).length;

  // Anything other than exactly one Earl + one standard: fall back to best single code.
  if (earlCount !== 1 || validated.length !== 2) {
    const best = validated.reduce((a, b) => (a.amount >= b.amount ? a : b));
    return { discount: best.amount, appliedCodes: [best.code] };
  }

  // Exactly one Earl + one standard — allowed.
  return {
    discount: validated.reduce((sum, v) => sum + v.amount, 0),
    appliedCodes: validated.map(v => v.code)
  };
}

// Stripe metadata values are capped at 500 chars. Compact the products payload
// aggressively so even a heavy cart stays under the limit.
function buildProductsMetadata(cleanProducts) {
  const compact = cleanProducts.map(p => ({
    n: p.name,
    c: p.categories
  }));
  let json = JSON.stringify(compact);
  if (json.length <= 490) return json;

  // Progressively truncate category/product names until we fit.
  const truncated = cleanProducts.map(p => ({
    n: p.name.length > 40 ? p.name.slice(0, 37) + '...' : p.name,
    c: p.categories.map(c => c.length > 45 ? c.slice(0, 42) + '...' : c)
  }));
  json = JSON.stringify(truncated);
  if (json.length <= 490) return json;

  // Last resort — just store product names + category counts.
  const summary = cleanProducts.map(p => ({
    n: p.name.length > 40 ? p.name.slice(0, 37) + '...' : p.name,
    ce: p.categories.length
  }));
  return JSON.stringify(summary).slice(0, 490);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('Missing STRIPE_SECRET_KEY env var');
      return res.status(500).json({ error: 'Server not configured — missing Stripe key' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    const productsMeta = buildProductsMetadata(cleanProducts);

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
        products: productsMeta,
        entries: String(totalEntries),
        discountCodes: appliedCodes.join(',').slice(0, 490),
        discountApplied: String(discount)
      },
      success_url: `${req.headers.origin || 'https://bestof-stem-calculator-2026.vercel.app'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://bestof-stem-calculator-2026.vercel.app/'
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err && err.message, err && err.stack);
    const message = (err && err.message) ? err.message : 'Unknown checkout error';
    return res.status(500).json({ error: message });
  }
};
