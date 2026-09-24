# The evaluator API

The page at evaluate.upscdesk.com is static and calls this Worker. Until it is deployed the
page loads, takes an email, and nothing arrives: there is no API behind it.

Four routes, which are exactly the four the page calls:

| Route | Does |
| --- | --- |
| `POST /auth/request` | Sends a six digit code to the email |
| `POST /auth/verify` | Exchanges the code for a token, and returns the month's allowance |
| `GET /me` | Who this is and what they have left this month |
| `POST /evaluate` | Marks one answer, and counts it |

## Deploying it

You need a Cloudflare account (the free tier is enough) and a Resend API key. Nothing below
writes a secret into a file: `wrangler secret put` prompts for each one and stores it with
Cloudflare.

```bash
cd worker
npm install
npx wrangler login                     # opens a browser, once

npx wrangler d1 create upscdesk-eval   # prints a database_id
# put that id into wrangler.toml, replacing PUT_THE_ID_...

npm run db:init                        # creates the three tables

npx wrangler secret put ANTHROPIC_API_KEY   # the marking model
npx wrangler secret put RESEND_API_KEY      # the code emails
npx wrangler secret put TOKEN_SECRET        # any long random string, e.g. `openssl rand -base64 32`
npx wrangler secret put SUBSCRIBERS_URL     # the existing Subscribers Apps Script GET endpoint

npm run deploy                         # prints the workers.dev URL
```

Then put that URL into `config.js` at the repository root, replacing the placeholder, and
push. That is the last wire: the page has been calling a host that does not exist.

## Two things to know before it goes live

**The `from` address must be a domain Resend has verified.** `wrangler.toml` sets
`MAIL_FROM` to `evaluate@upscdesk.com`; if that domain is not verified in Resend, every
code email fails and the page says the code could not be sent. Verify the domain in Resend
first, or change `MAIL_FROM` to an address on a domain that is.

**The subscriber lookup must answer with the desk and whether the subscription is live.**
`entitlement.js` reads `active` (or `status`) and `desk` (or `plan`) from the Apps Script's
JSON. If the live script answers in a different shape, that function is where to fix it; it
already falls back to the free allowance rather than failing the evaluation.

## What an evaluation costs

Each one is a single Claude Opus 5 call: the photograph, the question, the rubric, and a long
JSON answer that carries the transcription, the margin notes, a rewritten answer and a model
answer. Expect roughly 4,000 input and 3,000 output tokens, which is about 5 US cents, or a
little over four rupees. A Sociology subscriber's thirty a month is therefore about 130 rupees
against a 2,999 rupee plan; the five free ones cost about 21 rupees per person per month.

If that free tier proves expensive at volume, the cheaper lever is `claude-sonnet-5` in
`evaluate.js`, at roughly 40% of the cost. I have left it on Opus because the marking is the
product: an evaluation that flatters a weak answer is worse than none.
