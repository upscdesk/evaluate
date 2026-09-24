/* Small shared pieces: CORS, JSON replies, the IST month, and the signed token.
   The token is a signed value rather than a session row because the only thing it has
   to carry is "this email proved it owns this inbox", and a stateless token survives
   a D1 hiccup that a session table would not. */

export const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(env) },
  });

export const cors = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN,
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
  vary: 'origin',
});

/* Allowances reset on the first of the month, and the people using this are in India,
   so the month has to be the Indian one, not UTC's. */
export const istMonth = (d = new Date()) => {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
};

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function mintToken(env, email, days = 30) {
  const body = b64url(enc.encode(JSON.stringify({ email, exp: Date.now() + days * 86400e3 })));
  return `${body}.${await hmac(env.TOKEN_SECRET, body)}`;
}

export async function readToken(env, header) {
  const raw = (header || '').replace(/^Bearer\s+/i, '').trim();
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  // constant-time enough: compare the signatures we computed ourselves, not the payload
  if ((await hmac(env.TOKEN_SECRET, body)) !== sig) return null;
  try {
    const { email, exp } = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return exp > Date.now() ? email : null;
  } catch { return null; }
}

export const normaliseEmail = (e) => String(e || '').trim().toLowerCase();
export const looksLikeEmail = (e) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e);
