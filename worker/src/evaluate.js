/* Mark one answer.

   The model reads a photograph of a handwritten script, or typed text, and returns the
   whole evaluation as JSON. The shape is pinned with a schema rather than asked for in
   prose, because the page renders these fields directly and a missing one is a blank
   space on something the aspirant paid for. */
import Anthropic from '@anthropic-ai/sdk';
import { json, istMonth } from './util.js';
import { entitlement } from './entitlement.js';
import { DESKS, RESULT_SCHEMA, systemPrompt, userPrompt } from './rubric.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 4;
const OK_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// The page offers "a photo or PDF", and a scanned script is very often a PDF, so the
// promise on the page has to be true here.
const OK_PDF = 'application/pdf';

export async function evaluate(req, env, email, service = false) {
  const p = await req.json().catch(() => ({}));
  const desk = String(p.desk || '').toLowerCase();
  if (!DESKS[desk]) return json(env, { error: 'Pick which paper this answer is for.' }, 400);
  if (!p.question || !String(p.question).trim()) return json(env, { error: 'Paste the question exactly as it was set.' }, 400);
  if (!p.answer && !p.image && !(Array.isArray(p.pages) && p.pages.length)) {
    return json(env, { error: 'Type your answer, or attach a photograph of it.' }, 400);
  }
  // a script runs to more than one page; the older single-image field still works
  const pages = Array.isArray(p.pages) && p.pages.length
    ? p.pages
    : (p.image ? [{ data: p.image, type: p.image_type }] : []);
  if (pages.length > MAX_PAGES) {
    return json(env, { error: `Four pages is the most that can be marked at once.` }, 400);
  }
  for (const pg of pages) {
    if (!OK_IMAGE.includes(pg.type) && pg.type !== OK_PDF) {
      return json(env, { error: 'Attach a JPEG, PNG or PDF of each page.' }, 400);
    }
    // base64 is about 4/3 of the bytes it encodes
    if (String(pg.data || '').length * 0.75 > MAX_IMAGE_BYTES) {
      return json(env, { error: 'A page is over 5 MB. Photograph it again at lower resolution.' }, 400);
    }
  }

  // the daily pipeline marks the day's own specimen answer to build the Short's evaluation
  // card; that is the desk marking itself, so it neither spends an allowance nor is counted
  const ent = service
    ? { plan: 'Desk', allowance: 0, used: 0, remaining: 1, month: istMonth() }
    : await entitlement(env, email);
  if (ent.remaining <= 0) {
    return json(env, {
      error: ent.plan
        ? `You have used all ${ent.allowance} evaluations on your plan this month. They reset on the first.`
        : `You have used your ${ent.allowance} free evaluations this month. They reset on the first, or subscribe for more.`,
      entitlement: ent,
    }, 402);
  }

  const marks = Number(p.marks) || 10;
  const content = [];
  // a PDF goes in as a document, an image as an image; the model reads the handwriting
  // either way, and both must precede the text block. Pages go in the order they were
  // attached, because an answer is continuous across them.
  for (const pg of pages) {
    content.push(pg.type === OK_PDF
      ? { type: 'document', source: { type: 'base64', media_type: OK_PDF, data: pg.data } }
      : { type: 'image', source: { type: 'base64', media_type: pg.type, data: pg.data } });
  }
  content.push({ type: 'text', text: userPrompt({ paper: p.paper, marks, word_limit: Number(p.word_limit) || 150, question: p.question, answer: p.answer, pageCount: pages.length }) });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let result;
  try {
    // streamed: a full marked script with a transcription and a model answer is a long
    // output, and a non-streaming request that size risks the HTTP timeout
    const stream = client.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: [{ type: 'text', text: systemPrompt(desk), cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      return json(env, { error: 'The marker declined to read that submission. Send the answer on its own, with no other material.' }, 422);
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    result = JSON.parse(text);
  } catch (e) {
    console.error('marking failed', e?.message);
    const rate = e?.status === 429 || e?.status >= 500;
    return json(env, {
      error: rate ? 'The marker is busy. Try again in a minute; this did not use one of your evaluations.'
                  : 'The answer could not be marked. Try again; this did not use one of your evaluations.',
    }, 503);
  }

  // counted only once a real evaluation exists, so a failure never costs an allowance
  if (!service) await env.DB.prepare(
    'INSERT INTO evaluations (id, email, desk, paper, marks, score, month, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)'
  ).bind(crypto.randomUUID(), email, desk, String(p.paper || ''), marks, Number(result.score) || 0, ent.month, new Date().toISOString()).run();

  // renderResult(out.result, payload, out.entitlement): the evaluation is nested, not spread
  return json(env, service
    ? { result }
    : { result, entitlement: { ...ent, used: ent.used + 1, remaining: ent.remaining - 1 } });
}
