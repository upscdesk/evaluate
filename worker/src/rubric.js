/* What the examiner is told, and the exact shape the answer has to come back in.

   The three desks are marked on different things, so each gets its own dimensions and
   its own instruction about what separates a middling script from a good one. The bands
   are the ones the page and the pamphlets already state; nothing here invents a claim
   the product does not make. */

export const DESKS = {
  sociology: {
    name: 'Sociology Optional',
    marked_on: 'the concept, the thinker, and whether the two are actually put to work on Indian material',
    dimensions: ['concept_named', 'thinker_anchored', 'indian_evidence', 'structure_and_directive', 'critical_edge'],
    guidance: `A Sociology answer earns its marks by naming the concept in the opening lines and then using
it, not by narrating the event. Reward a named thinker with the concept attached and a counter-thinker where
the question invites one. Penalise an answer that narrates the news, or that name-drops a thinker without
putting the concept to work. Indian material must be used as evidence for the concept, not as the topic.`,
  },
  essay: {
    name: 'Essay',
    marked_on: 'decoding, thesis, range across domains, and whether the writer ever disagrees with themselves',
    dimensions: ['decoding_the_topic', 'thesis_and_position', 'range_across_domains', 'structure_and_flow', 'self_critique_and_close'],
    guidance: `An Essay earns its marks by decoding the topic into a real question and taking a position on it.
Reward range across domains, a thesis that is stated early and held, and a writer who tests their own claim
before closing. Penalise a list of paragraphs with no argument, an essay that never commits, and a close that
summarises instead of resolving. Marks are out of 125 for a section; be strict about the top band.`,
  },
  gs: {
    name: 'General Studies',
    marked_on: 'the directive, the named anchor, sourced data, and whether both limbs were answered',
    dimensions: ['directive_obeyed', 'both_limbs_answered', 'named_anchor_or_data', 'structure_and_headings', 'forward_close'],
    guidance: `A GS answer earns its marks by obeying the directive word and answering every limb of the
question. Reward a named committee, report, article, scheme or figure used in the right place. Penalise an
answer that describes when it was asked to examine, that answers one limb and forgets the other, or that
closes with a summary instead of a way forward.`,
  },
};

/* The page reads exactly these fields. Anything missing renders as a blank on a page the
   aspirant paid for, so the schema requires all of them. */
export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['transcription', 'words_written', 'score', 'attainable', 'ceiling', 'ceiling_note',
             'band', 'band_justification', 'dimensions', 'margin_comments', 'three_fixes',
             'verdict', 'rewritten_answer', 'model_answer'],
  properties: {
    transcription: { type: 'string', description: 'The answer exactly as written, paragraphs separated by a blank line. For a typed answer, repeat it unchanged.' },
    words_written: { type: 'integer' },
    score: { type: 'number', description: 'Marks this answer earns as written, out of the marks asked for.' },
    attainable: { type: 'number', description: 'What the same reading would earn with the corrections applied.' },
    ceiling: { type: 'number', description: 'The top this paper realistically awards for this question.' },
    ceiling_note: { type: 'string' },
    band: { type: 'string' },
    band_justification: { type: 'string', description: 'One sentence saying why this band and not the one above.' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'score', 'max', 'note'],
        properties: { name: { type: 'string' }, score: { type: 'number' }, max: { type: 'number' }, note: { type: 'string' } },
      },
    },
    margin_comments: {
      type: 'array',
      description: 'One per paragraph that deserves a note, in the order the paragraphs appear.',
      items: {
        type: 'object', additionalProperties: false, required: ['anchor', 'mark', 'label', 'note'],
        properties: {
          anchor: { type: 'string', description: 'The first few words of the paragraph this note belongs to, copied exactly.' },
          mark: { type: 'string', enum: ['well_written', 'strike', 'rewrite', 'insert'] },
          label: { type: 'string', description: 'Two or three words, e.g. "Concept late" or "Good anchor".' },
          note: { type: 'string', description: 'What an examiner would write in the margin. One or two sentences.' },
          target: { type: 'string', description: 'The exact phrase inside the paragraph the mark applies to, copied verbatim. Empty if the note is about the whole paragraph.' },
          suggested_text: { type: 'string', description: 'What to write instead. Empty when there is nothing to swap.' },
        },
      },
    },
    three_fixes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['fix', 'marks_at_stake'],
        properties: { fix: { type: 'string' }, marks_at_stake: { type: 'number' } },
      },
    },
    verdict: { type: 'string', description: 'If the writer changes one thing, what it should be.' },
    rewritten_answer: { type: 'string', description: "The writer's own answer with the corrections applied, in their own material." },
    model_answer: { type: 'string', description: 'How a top script would have answered the same question.' },
  },
};

export function systemPrompt(desk) {
  const d = DESKS[desk];
  return `You are a UPSC Civil Services examiner marking one answer. You have marked this paper for years
and you are neither generous nor cruel: you award what the script earns.

This is the ${d.name} paper. It is marked on ${d.marked_on}.

${d.guidance}

How to mark:
- Read what is actually on the page. Never credit something the writer did not write.
- The score is what this script earns as written. "attainable" is what the same reading would earn with
  your corrections applied, and it must be honest: corrections to expression move a script a little,
  a missing concept or a missed limb moves it more.
- Marks lost must add up. The dimension scores are marks lost against each dimension's maximum, and
  their maximums must sum to the marks the question carries.
- Every margin comment must anchor to a paragraph that exists, by copying its opening words into "anchor".
  Where the note is about one phrase, copy that phrase verbatim into "target" so it can be underlined.
- Write the margin notes as an examiner writes them: short, specific, and about this script.
- Do not praise an answer to be kind. An aspirant who is told a 9 is a 14 is being harmed.`;
}

export function userPrompt({ paper, marks, word_limit, question, answer }) {
  return `Paper: ${paper}
Marks: ${marks}
Word limit: ${word_limit}

The question as set:
${question}

${answer ? `The answer, as typed by the candidate:\n${answer}`
         : 'The answer is in the attached photograph of a handwritten script. Transcribe it faithfully first, keeping the paragraph breaks, and mark what is actually written, not what you think was meant.'}`;
}
