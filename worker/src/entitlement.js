/* What this person is allowed this month.

   Free is five a month for anybody with an email. A subscriber gets their plan's
   allowance instead: thirty on Sociology, twenty on Essay, ten on GS - the numbers the
   pamphlets and the page both state. Paid status comes from the Subscribers Apps Script
   that Razorpay already feeds, so there is one source of truth for who has paid. */
import { istMonth } from './util.js';

export const PLAN_ALLOWANCE = { sociology: 30, essay: 20, gs: 10 };

async function paidPlan(env, email) {
  if (!env.SUBSCRIBERS_URL) return null;
  try {
    const url = `${env.SUBSCRIBERS_URL}${env.SUBSCRIBERS_URL.includes('?') ? '&' : '?'}email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    // the sheet answers with the desk and whether the subscription is live
    const active = d.active ?? d.status === 'active';
    const desk = String(d.desk || d.plan || '').toLowerCase();
    if (!active) return null;
    return ['sociology', 'essay', 'gs'].find((k) => desk.includes(k)) || null;
  } catch (e) {
    // the evaluator must not go down because a Google script is slow; fall back to free
    console.error('subscriber lookup failed', e.message);
    return null;
  }
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
