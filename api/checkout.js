const Stripe = require('stripe');

// ---- Pricing & discount rules (source of truth) ----
// Earl E. Byrd early bird code expired May 5, 2026 and has been removed.
// EARL_DEADLINE and the isEarl flag are retained as defense-in-depth in case
// any legacy isEarl entry is ever reintroduced.
const EARL_DEADLINE = new Date('2026-05-05T23:59:59');

const CODES = {
  'KEHLUV2026':       { amount: 100, isEarl: false },
  '2026AWARDS':       { amount: 50,  isEarl: false },
  'DOLS2026':         { amount: 50,  isEarl: false },
  'FINNPARTNERS2026': { amount: 50,  isEarl: false },
  'MCH2026':          { amount: 100, isEarl: false }
};

function normalizeCode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Exact match path (punctuation preserved). E.g. "Kehluv 2026" → "KEHLUV2026".
  const upperNoSpaces = trimmed.replace(/\s+/g, '').toUpperCase();
  if (CODES[upperNoSpaces]) return upperNoSpaces;
  // Forgiving path: strip all non-alphanumerics and compare.
  // Also accepts an isEarl code without the trailing "2026" — retained for
  // any future early-bird code that might use the same flag.
  const stripped = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!stripped) return '';
  for (const key of Object.keys(CODES)) {
    const keyStripped = key.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (stripped === keyStripped) return key;
    if (CODES[key].isEarl && stripped === keyStripped.replace(/2026$/, '')) return key;
  }
  // No match — return the stripped form so server logs reflect the attempt.
  return upperNoSpaces;
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

  // With the early bird code retired, two codes can no longer be combined.
  // Fall back to the best single code so the customer still gets a discount
  // rather than nothing.
  const best = validated.reduce((a, b) => (a.amount >= b.amount ? a : b));
  return { discount: best.amount, appliedCodes: [best.code] };
}

// Stripe metadata values are capped at 500 chars. Keep the shape
// ({name, categories}) that webhook.js expects, but truncate names if needed.
function buildProductsMetadata(cleanProducts) {
  let payload = cleanProducts.map(p => ({
    name: p.name,
    categories: p.categories
  }));
  let json = JSON.stringify(payload);
  if (json.length <= 490) return json;

  // Progressively truncate long names.
  payload = cleanProducts.map(p => ({
    name: p.name.length > 50 ? p.name.slice(0, 47) + '...' : p.name,
    categories: p.categories.map(c => c.length > 55 ? c.slice(0, 52) + '...' : c)
  }));
  json = JSON.stringify(payload);
  if (json.length <= 490) return json;

  // Still too long — trim each product name more aggressively.
  payload = cleanProducts.map(p => ({
    name: p.name.length > 30 ? p.name.slice(0, 27) + '...' : p.name,
    categories: p.categories.map(c => c.length > 45 ? c.slice(0, 42) + '...' : c)
  }));
  json = JSON.stringify(payload);
  return json.length <= 490 ? json : json.slice(0, 490);
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
