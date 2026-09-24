/* What this person is allowed this month.

   Free is five a month for anybody with an email. A subscriber gets their plan's
   allowance instead: thirty on Sociology, twenty on Essay, ten on GS - the numbers the
   pamphlets and the page both state. Paid status comes from the Subscribers Apps Script
   that Razorpay already feeds, so there is one source of truth for who has paid. */
import { istMonth } from './util.js';

export const PLAN_ALLOWANCE = { sociology: 30, essay: 20, gs: 10 };

async function paidPlan(env, email) {
  if (!env.SUBSCRIBERS_URL) return null;
  // The Subscribers API answers with the live list for one desk - {active_emails, count} -
  // filtered by ?subject=, not with a record for one person. So ask each desk whether it
  // holds this address. Sociology first, so somebody who subscribes to more than one desk
  // gets the larger allowance rather than whichever answered first.
  const base = env.SUBSCRIBERS_URL;
  const ask = async (desk) => {
    try {
      const url = `${base}${base.includes('?') ? '&' : '?'}subject=${encodeURIComponent(desk)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'follow' });
      if (!res.ok) return null;
      const d = await res.json();
      if (!Array.isArray(d?.active_emails)) return null;
      return d.active_emails.some((e) => String(e).trim().toLowerCase() === email) ? desk : null;
    } catch (e) {
      // the evaluator must not go down because a Google script is slow or redeployed
      console.error(`subscriber lookup failed for ${desk}`, e.message);
      return null;
    }
  };
  const hits = await Promise.all(['sociology', 'essay', 'gs'].map(ask));
  return hits.find(Boolean) || null;
}

export async function entitlement(env, email) {
  const month = istMonth();
  const used = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM evaluations WHERE email = ?1 AND month = ?2'
  ).bind(email, month).first())?.n ?? 0;

  const plan = await paidPlan(env, email);
  const allowance = plan ? PLAN_ALLOWANCE[plan] : Number(env.FREE_PER_MONTH || 5);
  return {
    plan: plan ? `${plan[0].toUpperCase()}${plan.slice(1)} Desk` : null,
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    month,
  };
}
