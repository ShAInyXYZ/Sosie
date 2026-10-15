/**
 * The MiniMax H3 prompt for one talking segment, in the official section format
 * (see docs/reference/h3-singularity-prompt-spec.md). All words come from the user's inputs;
 * this file only holds the structure and the lip-sync instructions.
 */
export type TalkPromptInput = {
  /** Who is on camera, e.g. "a man in his thirties with short dark hair and a grey hoodie". Empty = rely on the picture. */
  subject: string
  /** The set behind them, e.g. "a cosy home office with a bookshelf and warm desk lamp". */
  set: string
  /** What is said in this segment, exactly as in the audio. */
  text: string
  /** Optional delivery note, e.g. "excited", "lean in". */
  direction?: string
  /** Language tag for the dialogue line. */
  language?: string
  /** Visual style line. */
  style?: string
  /** Write the spoken words into the prompt (default). Without them H3 can only follow <Audio 1>. */
  withDialogue?: boolean
}

/** Characters H3's dialogue markup uses; keep them out of spoken text. */
function clean(text: string): string {
  return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

export function talkPrompt(input: TalkPromptInput): string {
  const subject = clean(input.subject) || 'the person shown in <Picture 1>'
  const set = clean(input.set) || 'the room shown in <Picture 1>'
  const text = clean(input.text)
  if (!text) throw new Error('A talking segment needs text')
  const language = clean(input.language ?? 'English') || 'English'
  const direction = clean(input.direction ?? '')
  const article = /^[aeiou]/i.test(direction) ? 'an' : 'a'
  const tone = direction ? ` in ${article} ${direction} tone` : ' in a natural, conversational tone'
  const style = clean(input.style ?? '') || 'realistic photographic style, like a webcam stream'

  return [
    'subject_definitions:',
    `<Subject 1> is ${subject}, exactly as in <Picture 1>.`,
    `<Environment> is ${set}, exactly as in <Picture 1>.`,
    '<Audio 1> is the spoken voice of <Subject 1>.',
    '',
    'summary:',
    `[talking-head facecam] <Subject 1> talks directly to the camera in one continuous shot, saying the lines of <Audio 1>${tone}, with natural facial expressions, then finishes with the mouth relaxed and closed.`,
    '',
    'retention_analysis:',
    '<Picture 1> (<Subject 1> and <Environment>): fully_preserved - face, identity, hair, clothing, framing, background and lighting stay as in <Picture 1>; only the mouth, face and small head movements are animated.',
    '<Audio 1>: fully_copy - <Audio 1>',
    '',
    'detailed_description:',
    `The target video is in ${style}.`,
    '[Shot 1] A locked-off webcam shot at eye level frames <Subject 1> from the chest up, centred, with <Environment> behind. The camera does not move; single continuous shot, no cuts, no zoom.',
    input.withDialogue === false
      ? `<Subject 1> looks into the lens and speaks${tone}, saying exactly the words heard in <Audio 1>, in time with it.`
      : `<Subject 1> looks into the lens and speaks${tone}. (S1) <d>[${language}] ${text}</d>`,
    "Their lips, jaw and cheeks move in exact sync with every syllable of <Audio 1>. Small natural head movements, blinks and eyebrow raises follow the rhythm of the speech; hands stay low and away from the face. When the voice stops, the mouth closes and <Subject 1> keeps looking at the camera.",
    '',
    'overall_soundscape:',
    'Only the clear, close-miked voice of <Subject 1> from <Audio 1>, in a quiet room.',
    '',
    'non_diegetic_music:',
    'None.',
  ].join('\n')
}
