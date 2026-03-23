# 2026 Best of STEM Awards — Entry Calculator

Live category selector and pricing calculator for the 2026 Educators Pick Best of STEM® Awards. Built for bestofstemawards.com.

## What this does

Applicants can:
- Enter one or more products in a single session
- Select award categories per product (each category = one entry)
- Watch pricing update live as they select (tier breaks at 1 / 2–4 / 5+ entries)
- Apply discount codes before checkout
- Click through to Stripe payment (Stripe integration required — see below)

After payment, applicants are redirected to the QuestionPro application form with their basic info pre-filled.

---

## Pricing tiers

| Entries | Price per entry |
|---------|----------------|
| 1 | $745 |
| 2–4 | $625 each |
| 5+ | $575 each |

---

## Discount codes

| Code | Discount | Notes |
|------|----------|-------|
| `EARLE.BYRD2026` | $100 off total | Expires May 5, 2026. Can be combined with ONE other code. |
| `KEHLUV2026` | $100 off total | Cannot be combined with another standard code. |
| `2026AWARDS` | $50 off total | Cannot be combined with another standard code. |

Combination rules enforced in the UI:
- Earl E. Byrd + one standard code = allowed
- Two standard codes (no Earl E. Byrd) = blocked
- Two Earl E. Byrd codes = blocked
- Earl E. Byrd submitted after May 5, 2026 = blocked with expiry message

To update codes, find `const CODES` in `index.html` and edit the values.

---

## Deploy to Vercel

1. Push this folder to a GitHub repo (set to Public)
2. Go to [vercel.com](https://vercel.com) → sign in with GitHub
3. Click **Add New → Project** → import your repo
4. Framework preset: **Other** — leave all other settings as defaults
5. Click **Deploy**

Vercel provides a live URL instantly (e.g. `https://best-of-stem-entry.vercel.app`). Any subsequent push to GitHub triggers an automatic redeploy.

---

## Developer handoff — Stripe + QuestionPro integration

The "Proceed to payment" button is wired and ready. A developer needs to connect it to Stripe and handle the post-payment redirect.

**Scope (approx. 2–3 hours):**

1. Add a Vercel serverless function (`/api/checkout.js`) that creates a Stripe Checkout Session with the computed total as a line item
2. On payment success, Stripe redirects to the QuestionPro survey URL with pre-filled parameters

**QuestionPro survey:**
`https://www.questionpro.com/a/ExtSurveyPreview?tt=/uvQz4F0Bnsz8dN1Sg2arAQIes94hb15`

**QuestionPro pre-fill URL pattern** (confirm exact parameter names in QuestionPro account settings):
```
https://www.questionpro.com/a/TakeSurvey?tt=YOUR_SURVEY_ID
  &custom1=PRODUCT_NAME
  &custom2=COMPANY_NAME
  &custom3=EMAIL
  &custom4=SELECTED_CATEGORIES
```

**Stripe account:** Already set up. Provide developer with API keys from the Stripe dashboard.

**Zapier automations** (separate from developer task — configure yourself):
- QuestionPro → Copper CRM: create/update contact on submission
- QuestionPro → Mailchimp: add to audience, trigger confirmation email sequence
- Incomplete submissions → Mailchimp follow-up reminder

---

## Stack

- Pure HTML / CSS / JavaScript — no framework, no build step
- Vercel hosts static files natively — no server configuration needed
- Serverless function for Stripe (developer task) runs on Vercel's free tier
- No WordPress dependency for the calculator page
