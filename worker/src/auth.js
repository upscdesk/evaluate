/* Sign in by email. A six digit code, valid ten minutes, five attempts.

   Two deliberate choices. The code is stored hashed, so the table is never a list of
   live codes. And /auth/request answers the same way whether or not the address is
   known, so the endpoint cannot be used to find out who has an account. */
import { json, sha256, mintToken, normaliseEmail, looksLikeEmail } from './util.js';
import { entitlement } from './entitlement.js';

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');

async function sendCode(env, email, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: `${code} is your UPSC Desk code`,
      text: `${code}\n\nThis code signs you in at evaluate.upscdesk.com. It expires in ten minutes.\n\nIf you did not ask for it, ignore this email; nobody can sign in without it.\n\nUPSC Desk`,
    }),
  });
  if (!res.ok) {
    // the caller turns this into a plain message; the body often names the real cause
    throw new Error(`email provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export async function authRequest(req, env) {
  const { email: raw } = await req.json().catch(() => ({}));
  const email = normaliseEmail(raw);
  if (!looksLikeEmail(email)) return json(env, { error: 'That does not look like an email address.' }, 400);

  // one live code at a time, and a floor on how often a new one can be asked for
  const recent = await env.DB.prepare(
    'SELECT created_at FROM codes WHERE email = ?1 ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first();
  if (recent && Date.now() - recent.created_at < 45_000) {
    return json(env, { error: 'A code is already on its way. Check your inbox, then try again in a minute.' }, 429);
  }

  const code = sixDigits();
  try {
    await sendCode(env, email, code);
  } catch (e) {
    console.error('send failed', e.message);
    return json(env, { error: 'The code could not be sent just now. Try again in a minute.' }, 502);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM codes WHERE email = ?1').bind(email),
    env.DB.prepare('INSERT INTO codes (email, code_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(email, await sha256(`${email}:${code}`), Date.now() + TTL_MS, Date.now()),
    env.DB.prepare('INSERT OR IGNORE INTO people (email, created_at) VALUES (?1, ?2)')
      .bind(email, new Date().toISOString()),
  ]);
  return json(env, { sent: true });
}

export async function authVerify(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(body.email);
  const code = String(body.code || '').trim();
  if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) {
    return json(env, { error: 'Enter the six digit code from the email.' }, 400);
  }

  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM codes WHERE email = ?1').bind(email).first();
  if (!row) return json(env, { error: 'That code has expired. Ask for a new one.' }, 400);
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM codes WHERE email = ?1').bind(email).run();
    return json(env, { error: 'That code has expired. Ask for a new one.' }, 400);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('DELETE FROM codes WHERE email = ?1').bind(email).run();
    return json(env, { error: 'Too many wrong codes. Ask for a new one.' }, 429);
  }
  if ((await sha256(`${email}:${code}`)) !== row.code_hash) {
    await env.DB.prepare('UPDATE codes SET attempts = attempts + 1 WHERE email = ?1').bind(email).run();
    return json(env, { error: 'That code is not right.' }, 400);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM codes WHERE email = ?1').bind(email),
    env.DB.prepare('UPDATE people SET last_seen = ?2 WHERE email = ?1').bind(email, new Date().toISOString()),
  ]);
  // the page moves straight to the compose step off this reply, reading out.entitlement,
  // so the allowance has to come back with the token
  return json(env, { token: await mintToken(env, email), email, entitlement: await entitlement(env, email) });
}
