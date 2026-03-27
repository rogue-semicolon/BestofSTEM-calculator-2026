import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ZAPIER_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/20377223/unb1vea/';
const QUESTIONPRO_SURVEY_ID = '13481598';
const QUESTIONPRO_BASE_URL = 'https://catapult-x.questionpro.com/BestofSTEMentry';

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildSurveyLinks(products, company, email) {
  return products.map(product => {
    const categoriesStr = Array.isArray(product.categories)
      ? product.categories.join(',')
      : (product.categories || '');

    const params = new URLSearchParams({
      tt: QUESTIONPRO_SURVEY_ID,
      custom1: product.name,
      custom2: company,
      custom3: email,
      custom4: categoriesStr
    });

    const url = `${QUESTIONPRO_BASE_URL}?${params.toString()}`;
    const categoryList = Array.isArray(product.categories)
      ? product.categories.map(c => `  • ${c}`).join('\n')
      : `  • ${product.categories}`;

    return `${product.name}\nCategories:\n${categoryList}\nApplication link: ${url}`;
  }).join('\n\n---\n\n');
}
function buildSurveyLinksHtml(products, company, email) {
  const blocks = products.map(product => {
    const categoriesStr = Array.isArray(product.categories)
      ? product.categories.join(', ')
      : (product.categories || '');

    const params = new URLSearchParams({
      tt: QUESTIONPRO_SURVEY_ID,
      custom1: product.name,
      custom2: company,
      custom3: email,
      custom4: categoriesStr
    });

    const url = `${QUESTIONPRO_BASE_URL}?${params.toString()}`;
    const categoryItems = Array.isArray(product.categories)
      ? product.categories.map(c => `<li>${c}</li>`).join('')
      : `<li>${product.categories}</li>`;

    return `
      <div style="margin-bottom:24px;padding:16px;border:1px solid #e0e0e0;border-radius:6px;">
        <p style="margin:0 0 8px;font-weight:600;font-size:15px;">${product.name}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#555;">Categories entered:</p>
        <ul style="margin:0 0 12px;padding-left:20px;font-size:13px;color:#333;">${categoryItems}</ul>
        <a href="${url}" style="display:inline-block;background:#d82356;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:600;">Complete application for ${product.name}</a>
      </div>`;
  }).join('');

  return blocks;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;

  const email = session.customer_details?.email || '';
  const name = session.customer_details?.name || '';
  const companyField = session.custom_fields?.find(f => f.key === 'company_name');
  const company = companyField?.text?.value || '';
  const products = JSON.parse(session.metadata?.products || '[]');
  const amountPaid = session.amount_total / 100;
  const surveyLinks = buildSurveyLinks(products, company, email);

  const zapierPayload = {
    email,
    name,
    company,
    amountPaid,
    products,
    entries: session.metadata?.entries,
    discountCodes: session.metadata?.discountCodes,
    discountApplied: session.metadata?.discountApplied,
    stripeSessionId: session.id,
    paidAt: new Date(session.created * 1000).toISOString(),
surveyLinks,
    surveyLinksHtml: buildSurveyLinksHtml(products, company, email)
  };

  try {
    const response = await fetch(ZAPIER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zapierPayload)
    });

    if (!response.ok) {
      console.error('Zapier POST failed:', response.status);
    }
  } catch (err) {
    console.error('Zapier POST error:', err.message);
  }

  res.status(200).json({ received: true });
}
