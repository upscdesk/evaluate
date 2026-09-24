/* The evaluator API behind evaluate.upscdesk.com.

   Four routes, which are exactly the four the page calls:
     POST /auth/request  {email}          send a six digit code
     POST /auth/verify   {email, code}    exchange it for a token
     GET  /me                              what this person is allowed this month
     POST /evaluate      {desk, ...}       mark one answer
*/
import { json, cors, readToken } from './util.js';
import { authRequest, authVerify } from './auth.js';
import { entitlement } from './entitlement.js';
import { evaluate } from './evaluate.js';

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    try {
      if (req.method === 'POST' && pathname === '/auth/request') return await authRequest(req, env);
      if (req.method === 'POST' && pathname === '/auth/verify') return await authVerify(req, env);

      // everything past here needs a signed-in email
      const email = await readToken(env, req.headers.get('authorization'));
      if (pathname === '/me' || pathname === '/evaluate') {
        if (!email) return json(env, { error: 'Sign in again.' }, 401);
        if (req.method === 'GET' && pathname === '/me') return json(env, { email, entitlement: await entitlement(env, email) });
        if (req.method === 'POST' && pathname === '/evaluate') return await evaluate(req, env, email);
      }
      if (pathname === '/health') return json(env, { ok: true });
      return json(env, { error: 'No such endpoint.' }, 404);
    } catch (e) {
      console.error('unhandled', e?.stack || e);
      return json(env, { error: 'Something went wrong here. Try again in a minute.' }, 500);
    }
  },
};
