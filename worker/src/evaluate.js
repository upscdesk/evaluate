/* Mark one answer.

   The model reads a photograph of a handwritten script, or typed text, and returns the
   whole evaluation as JSON. The shape is pinned with a schema rather than asked for in
   prose, because the page renders these fields directly and a missing one is a blank
   space on something the aspirant paid for. */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './util.js';
import { entitlement } from './entitlement.js';
import { DESKS, RESULT_SCHEMA, systemPrompt, userPrompt } from './rubric.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OK_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function evaluate(req, env, email) {
  const p = await req.json().catch(() => ({}));
  const desk = String(p.desk || '').toLowerCase();
  if (!DESKS[desk]) return json(env, { error: 'Pick which paper this answer is for.' }, 400);
  if (!p.question || !String(p.question).trim()) return json(env, { error: 'Paste the question exactly as it was set.' }, 400);
  if (!p.answer && !p.image) return json(env, { error: 'Type your answer, or attach a photograph of it.' }, 400);
  if (p.image) {
    if (!OK_IMAGE.includes(p.image_type)) return json(env, { error: 'Attach a JPEG, PNG or WebP photograph.' }, 400);
    // base64 is about 4/3 of the bytes it encodes
    if (String(p.image).length * 0.75 > MAX_IMAGE_BYTES) {
      return json(env, { error: 'That image is over 5 MB. Photograph the page again at lower resolution.' }, 400);
    }
  }

  const ent = await entitlement(env, email);
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
  if (p.image) content.push({ type: 'image', source: { type: 'base64', media_type: p.image_type, data: p.image } });
  content.push({ type: 'text', text: userPrompt({ paper: p.paper, marks, word_limit: Number(p.word_limit) || 150, question: p.question, answer: p.answer }) });

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
  await env.DB.prepare(
    'INSERT INTO evaluations (id, email, desk, paper, marks, score, month, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)'
  ).bind(crypto.randomUUID(), email, desk, String(p.paper || ''), marks, Number(result.score) || 0, ent.month, new Date().toISOString()).run();

  // renderResult(out.result, payload, out.entitlement): the evaluation is nested, not spread
  return json(env, { result, entitlement: { ...ent, used: ent.used + 1, remaining: ent.remaining - 1 } });
}
