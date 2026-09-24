/* UPSC Desk evaluator. Static page on Pages, Cloudflare Worker behind it. */

const API = window.EVAL_API || 'https://upscdesk-eval.workers.dev';
const TOKEN_KEY = 'upscdesk_eval_token';
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
let token = localStorage.getItem(TOKEN_KEY) || null;
let desk = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ desks */
const CFG = {
  sociology: { sub: 'Sociology Optional', papers: ['Paper I', 'Paper II'],
    marks: [[10, 150, 1], [20, 250, 1]], evals: 30, area: 'Sociology Optional' },
  essay: { sub: 'Essay', papers: ['Section A', 'Section B'],
    marks: [[125, 1200, 2]], evals: 20, area: 'Essay' },
  gs: { sub: 'General Studies', papers: ['GS-I', 'GS-II', 'GS-III', 'GS-IV'],
    marks: [[10, 150, 1], [15, 250, 1], [20, 250, 1]], evals: 10, area: 'General Studies' },
};
const FREE = 5;

/* -------------------------------------------------------------------- api */
async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) throw Object.assign(new Error(body.error || `request failed (${res.status})`),
    { status: res.status, body });
  return body;
}
function fail(where, msg) { $(where).innerHTML = `<div class="err">${esc(msg)}</div>`; }

/* ------------------------------------------------------------------- auth */
$('send-code').onclick = async () => {
  $('auth-err').innerHTML = '';
  const email = $('email').value.trim();
  if (!email) return fail('auth-err', 'Enter your email first.');
  $('send-code').disabled = true;
  try {
    await api('/auth/request', { method: 'POST', body: JSON.stringify({ email }) });
    $('sent-to').textContent = email;
    hide('step-email'); show('step-code'); $('code').focus();
  } catch (e) { fail('auth-err', e.message); }
  finally { $('send-code').disabled = false; }
};
$('back').onclick = () => { hide('step-code'); show('step-email'); $('auth-err').innerHTML = ''; };
$('verify').onclick = async () => {
  $('auth-err').innerHTML = '';
  $('verify').disabled = true;
  try {
    const out = await api('/auth/verify', { method: 'POST',
      body: JSON.stringify({ email: $('email').value.trim(), code: $('code').value.trim() }) });
    token = out.token; localStorage.setItem(TOKEN_KEY, token);
    enterCompose(out.entitlement, $('email').value.trim());
  } catch (e) { fail('auth-err', e.message); }
  finally { $('verify').disabled = false; }
};
$('signout').onclick = (e) => {
  e.preventDefault();
  localStorage.removeItem(TOKEN_KEY); token = null;
  hide('compose'); hide('result'); show('auth'); hide('step-code'); show('step-email');
};

/* ---------------------------------------------------------------- compose */
function pips(used) {
  $('pips').innerHTML = Array.from({ length: FREE },
    (_, i) => `<span class="pip${i < used ? ' off' : ''}"></span>`).join('');
}
function entitlementLine(ent) {
  if (!ent) return '';
  return ent.plan
    ? `Subscriber, ${esc(ent.plan)}. ${ent.remaining} of ${ent.allowance} evaluations left this month.`
    : `${ent.remaining} of ${ent.allowance} free evaluations left this month.`;
}
function fillDesk(d) {
  desk = d;
  const c = CFG[d];
  document.documentElement.setAttribute('data-theme', d);
  document.querySelectorAll('.desk').forEach((x) =>
    x.setAttribute('aria-selected', String(x.dataset.desk === d)));
  $('hdsub').textContent = 'Answer evaluation · ' + c.sub;
  $('paper').innerHTML = c.papers.map((p) => `<option>${esc(p)}</option>`).join('');
  $('marks').innerHTML = c.marks.map(([m, w, cost]) =>
    `<option value="${cost}" data-marks="${m}" data-words="${w}">${m} marks, ${w.toLocaleString()} words</option>`).join('');
  cost();
}
function cost() {
  const n = Number($('marks').value || 1);
  $('cost').innerHTML = `This uses <b>${n}</b> of your free evaluations. It takes about a minute.`;
}
function enterCompose(ent, email) {
  hide('auth'); hide('result'); show('compose');
  if (email) $('who').textContent = email;
  $('left').textContent = entitlementLine(ent);
  pips(ent ? ent.used || 0 : 0);
  fillDesk(desk || 'sociology');
}
document.getElementById('desks').addEventListener('click', (e) => {
  const d = e.target.closest('.desk'); if (d) fillDesk(d.dataset.desk);
});
$('marks').onchange = cost;

/* ----------------------------------------------------------------- submit */
const readImage = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onerror = () => rej(new Error('could not read that image'));
  r.onload = () => res({ data: String(r.result).split(',')[1], type: file.type || 'image/jpeg' });
  r.readAsDataURL(file);
});

$('go').onclick = async () => {
  const errBox = $('compose-err') || (() => {
    const d = document.createElement('div'); d.id = 'compose-err';
    $('go').parentElement.appendChild(d); return d;
  })();
  errBox.innerHTML = '';
  const question = $('q').value.trim();
  const answer = $('ans').value.trim();
  const file = $('photo') ? $('photo').files[0] : null;
  if (!question) return fail('compose-err', 'Paste the question exactly as it was set.');
  if (!answer && !file) return fail('compose-err', 'Type your answer, or attach a photograph of it.');
  if (file && file.size > 5 * 1024 * 1024)
    return fail('compose-err', 'That image is over 5 MB. Photograph the page again at lower resolution.');

  const opt = $('marks').selectedOptions[0];
  const payload = { desk, paper: $('paper').value,
    marks: Number(opt.dataset.marks), word_limit: Number(opt.dataset.words), question };
  if (file) { const img = await readImage(file); payload.image = img.data; payload.image_type = img.type; }
  else payload.answer = answer;

  $('go').disabled = true; const label = $('go').innerHTML;
  $('go').textContent = 'Evaluating, about a minute';
  try {
    const out = await api('/evaluate', { method: 'POST', body: JSON.stringify(payload) });
    renderResult(out.result, payload, out.entitlement);
  } catch (e) {
    if (e.status === 402) fail('compose-err',
      'No evaluations left this month. Subscriber plans include a monthly allowance.');
    else if (e.status === 401) { fail('compose-err', 'Your session expired. Sign in again.'); $('signout').click(); }
    else fail('compose-err', e.message);
  } finally { $('go').disabled = false; $('go').innerHTML = label; }
};

/* --------------------------------------------------- the marked-up script */
const MARK = { well_written: 'hl', strike: 'st', rewrite: 'wv' };

function markParagraph(text, c, i) {
  let html = esc(text);
  if (c) {
    const t = c.target && esc(c.target);
    const cls = MARK[c.mark];
    const sup = `<sup class="m">${i}</sup>`;
    if (t && html.includes(t)) {
      const caret = c.mark === 'insert' ? ' <span class="cr">&#94;</span>' : '';
      html = html.replace(t, `<span class="${cls || 'bk'}">${t}</span>${sup}${caret}`);
    } else {
      html += sup;                       // anchor drifted: still number the note
    }
  }
  return html;
}

function booklet(r, sub) {
  const paras = String(sub.answer || r.transcription || '').split(/\n\s*\n/).filter((p) => p.trim());
  const notes = (r.margin_comments || []).slice();
  const rows = [];
  let n = 0;
  paras.forEach((p) => {
    const head = p.trim().slice(0, 40).toLowerCase();
    const idx = notes.findIndex((c) => c.anchor && head.startsWith(String(c.anchor).slice(0, 24).toLowerCase()));
    const c = idx >= 0 ? notes.splice(idx, 1)[0] : null;
    if (c) n += 1;
    rows.push(`
      <div class="note">${c ? `
        <span class="tag${c.mark === 'well_written' ? ' good' : ''}">${esc(c.label || 'Note')}</span>
        <p><span class="num">${n}.</span> ${esc(c.note)}</p>
        ${c.suggested_text ? `<span class="do">Write instead: ${esc(c.suggested_text)}</span>` : ''}` : ''}
      </div>
      <div class="para"><p>${markParagraph(p.trim(), c, n)}</p><span class="pad"></span></div>`);
  });
  return `<div class="colhd"><span>Examiner's margin</span><span>Answer script as submitted</span></div>
    <div class="booklet">${rows.join('')}</div>`;
}

/* --------------------------------------------------------------- the page */
const fig = (v, max) => `<div class="v">${v}<small>out of ${max}</small></div>`;
const paperLevel = (v) => `<div class="paper">about <b>${Math.round(v * 2)} of 250</b> at paper level</div>`;

function renderResult(r, sub, ent) {
  const c = CFG[sub.desk];
  const isEssay = sub.desk === 'essay';
  const reach = r.attainable ?? r.score;
  const ceil = r.ceiling ?? reach;
  const lost = (sub.marks - r.score).toFixed(1).replace(/\.0$/, '');

  const dims = (r.dimensions || []).map((d) =>
    `<tr><td>${esc(String(d.name).replace(/_/g, ' '))}${d.note ? `<br><span class="hint">${esc(d.note)}</span>` : ''}</td>
     <td class="m">${d.score} / ${d.max}</td></tr>`).join('');
  const fixes = (r.three_fixes || []).map((f) =>
    `<tr><td>${esc(f.fix || f)}</td><td class="m">${f.marks_at_stake ?? ''}</td></tr>`).join('');

  $('result').innerHTML = `
  <div class="hd"><div class="wm">UPSC DESK</div>
    <div class="sub">Evaluated answer script &middot; ${esc(c.sub)}</div></div>
  <div class="meta">
    <div><div class="k">Paper</div><div class="v">${esc(sub.paper)}</div></div>
    <div><div class="k">Marks</div><div class="v">${sub.marks}</div></div>
    <div><div class="k">Words</div><div class="v">${r.words_written ?? '&mdash;'} of ${sub.word_limit}</div></div>
    <div><div class="k">Submitted</div><div class="v">${sub.image ? 'Handwritten, photographed' : 'Typed'}</div></div>
    <div><div class="k">Evaluated</div><div class="v">${new Date().toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
  </div>
  <div class="qbar"><div class="k">Question as set</div><div class="q">${esc(sub.question)}</div></div>

  ${booklet(r, sub)}

  <div class="sechd"><span class="ico"></span><div><h2>The observation</h2>
    <p>What this answer scored, what it would score with the corrections above, and how far it could go</p></div></div>
  <div class="body">
    <div class="ladder">
      <div class="rung"><div class="k">As written</div>${fig(r.score, sub.marks)}
        ${isEssay ? paperLevel(r.score) : ''}<div class="n">${esc(r.band_justification || r.band || '')}</div></div>
      <div class="rung next"><div class="k">With the corrections</div>${fig(reach, sub.marks)}
        ${isEssay ? paperLevel(reach) : ''}<div class="n">Using the reading you already have, put to different use.</div></div>
      <div class="rung ceil"><div class="k">How far this could go</div>${fig(ceil, sub.marks)}
        ${isEssay ? paperLevel(ceil) : ''}<div class="n">${esc(r.ceiling_note || 'The top band this paper actually awards.')}</div></div>
    </div>
    <table><tr><th>How the ${r.score} marks were earned, and where ${lost} went</th><th style="text-align:right">Earned</th></tr>${dims}</table>
    ${r.verdict ? `<p class="verdict"><strong>If you change one thing, change this.</strong> ${esc(r.verdict)}</p>` : ''}
  </div>

  ${r.three_fixes ? `<div class="sechd"><span class="ico"></span><div><h2>The three fixes worth the most</h2>
    <p>Ranked by the marks each one recovers</p></div></div>
    <div class="body"><table><tr><th>Fix</th><th style="text-align:right">Marks</th></tr>${fixes}</table></div>` : ''}

  ${r.rewritten_answer ? `<div class="sechd"><span class="ico"></span><div><h2>Your answer, rewritten</h2>
    <p>Your own sentences with the corrections applied</p></div></div>
    <div class="prose">${r.rewritten_answer}</div>` : ''}

  ${r.model_answer ? `<div class="sechd"><span class="ico"></span><div><h2>A model answer</h2>
    <p>The same question written to the top band, inside the same word limit</p></div></div>
    <div class="prose"><p>${esc(r.model_answer).replace(/\n\n/g, '</p><p>')}</p></div>` : ''}

  <div class="sechd"><span class="ico"></span><div><h2>Keep this</h2>
    <p>A record of where you stood today, to set beside the next answer you write</p></div></div>
  <div class="cardwrap">
    <div class="stmt">
      <div class="shd"><div class="wm">UPSC Desk</div><div class="ttl">Statement of evaluation</div></div>
      <div class="srows">
        <div class="sr"><div class="k">Paper</div><div class="v">${esc(c.area)}, ${esc(sub.paper)}</div></div>
        <div class="sr"><div class="k">Question</div><div class="v">${esc(sub.question.slice(0, 150))}</div></div>
        <div class="sr"><div class="k">Date of evaluation</div><div class="v">${new Date().toLocaleDateString('en-GB',
          { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
      </div>
      <div class="sband">
        <div class="grp"><div class="k">Marks awarded</div>${fig(r.score, sub.marks)}
          ${isEssay ? `<div class="lvl">about <b>${Math.round(r.score * 2)} of 250</b> at paper level</div>` : ''}</div>
        <div class="sdiv"></div>
        <div class="grp alt"><div class="k">Attainable on this script</div>${fig(reach, sub.marks)}
          ${isEssay ? `<div class="lvl">about <b>${Math.round(reach * 2)} of 250</b> at paper level</div>` : ''}</div>
      </div>
      <div class="snote">${esc(r.verdict || '')}</div>
      <div class="ssig"><span>Evaluated against the UPSC Mains rubric</span><span>evaluate.upscdesk.com</span></div>
    </div>
    <div class="btns">
      <button class="btn alt" id="again">Evaluate another</button>
      <button class="btn alt" id="cp">Copy the text</button><span id="copied" class="hidden">Copied</span>
    </div>
  </div>`;

  hide('compose'); show('result'); window.scrollTo(0, 0);
  $('left').textContent = entitlementLine(ent);
  $('again').onclick = () => { hide('result'); show('compose'); window.scrollTo(0, 0); };
  $('cp').onclick = async () => {
    const t = `UPSC Desk, Statement of evaluation\n\nPaper: ${c.area}, ${sub.paper}\n`
      + `Question: ${sub.question}\nDate: ${new Date().toLocaleDateString('en-GB')}\n\n`
      + `Marks awarded: ${r.score} out of ${sub.marks}\n`
      + `Attainable on this script: ${reach} out of ${sub.marks}\n\n${r.verdict || ''}\n\nevaluate.upscdesk.com`;
    try { await navigator.clipboard.writeText(t); } catch (_) {}
    $('copied').classList.remove('hidden');
    setTimeout(() => $('copied').classList.add('hidden'), 1800);
  };
}

/* ------------------------------------------------------------------ start */
(async function start() {
  if (!token) { fillDesk('sociology'); return; }
  try { const me = await api('/me'); enterCompose(me.entitlement, me.email); }
  catch (_) { localStorage.removeItem(TOKEN_KEY); token = null; }
})();
