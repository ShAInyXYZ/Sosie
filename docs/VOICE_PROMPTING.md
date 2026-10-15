# Voice prompting

How Sosie's two voice engines are steered, and how a script controls them. The script AI follows this guide
(`ENGINE_GUIDE` in `server/script-ai.ts`); people and agents writing scripts by hand can follow it too.

## Script lines

One spoken breath per line. A trailing bracket holds the delivery note and the controls, separated by `;`:

```
There was no war. [Flat and heavy, steady stare; pace 0.85; pause 0.6]
(sigh) By the time anyone noticed, [Tired gravelly sigh, then steady and grave; pace 0.92; pause 0.25]
A yawn. [Dry, quietly amused gravel, stress on yawn; pace 0.85; pause 1.4]
```

| Part | Meaning |
|---|---|
| delivery note | How the line is said. Breeze performs it; the video prompt uses it for the face with both engines. |
| `pace` | Speed, 1 = the voice's natural speed (0.7 to 1.3). Applied as a pitch-preserving stretch of that line. |
| `pause` | Seconds of silence after the line (0 to 3). Without it: 0.5 s after a sentence, 0.3 s inside one. |
| `(laugh)` `(sigh)` `(cough)` `(clears throat)` | Vocal events in the text, performed by Breeze. Removed from captions, word timing and the video prompt; Dots never sees them. |

Each line is voiced on its own, trimmed to its speech (the engines leave up to 0.9 s of silence around a line),
stretched to its pace, then joined with its pause, so the timing in the script is the timing in the video.

## Breeze TTS 2

Clones a voice from a reference clip and its exact transcript. With a delivery note it switches to Voice
Direction (CFG 4), which keeps the identity and steers the performance. Sources: the
[model card](https://huggingface.co/BreezeBlue/breeze-tts-2), the vendored README (`py/breeze-tts/README.md`)
and the nine judging categories of BreezeBlue's
[voice direction benchmark](https://github.com/breezeblue-ai/TTS-Voice-Direction-Benchmark).

A good note is 5 to 20 words and names what the moment needs:

- **emotion with nuance**, not a broad label: "quietly amused", "restrained anger", "relieved, a little shaky";
- **intent toward the listener**: reassure, warn, persuade, tease, command, confide;
- **prosody**: pace, loudness, pitch movement, where it pauses, which word gets the stress;
- **physical state or role**: breathy, tired, smiling while talking, an old sailor;
- **a change inside the line**: "starts calm, ends urgent".

Vocal events go in the text where they happen. Only the four above are documented; use them sparingly.
The output is 24 kHz.

## Dots TTS

[dots.tts](https://github.com/studio-dots-ai/dots.tts) SOAR (dots-studio, Apache-2.0) clones by continuation: it
copies the reference's timbre, pace and mood and reads the text's wording and punctuation. It has no instruction
input and no emotion or event tokens (its tokenizer adds only audio markers and an optional language tag), so:

- the feeling lives in the words: short sentences and fragments, commas and em dashes for breaths, an ellipsis
  for hesitation, question and exclamation marks, interjections people really say ("Hah.", "Listen.");
- pace and pause are the main controls; Dots speaks at the reference's speed, often fast, so storytelling usually
  wants pace 0.85 to 0.95 and pauses of 0.6 to 1.5 s;
- the reference shapes the delivery: a calm reference gives calm lines;
- the seed changes the prosody; another seed is another reading.

Settings: SOAR bf16, 15 steps, CFG 1.2 (upstream recommends 10 to 32 steps). The output stays 48 kHz into the video.
Dots uses the voice's `ref-hq.wav` (48 kHz) when it has one; voices imported since this change get it.

dots.tts.edit (`<emo>`, `<rate>`, `<pause/>` tags on finished speech) was tried on 2026-10-15 and not adopted:
the added emotion did not convince by ear.

## Setup (Dots)

Dots runs in its own environment, `py/dots-tts` (gitignored), because its pinned torch and transformers differ
from Breeze's:

```sh
git clone https://github.com/studio-dots-ai/dots.tts.git py/dots-tts
cd py/dots-tts && uv venv --python 3.12 .venv
grep -v '^gradio' constraints/recommended.txt > .constraints-local.txt   # the gradio pin is not on PyPI
VIRTUAL_ENV=$PWD/.venv uv pip install -e . -c .constraints-local.txt
.venv/bin/hf download dots-studio/dots.tts-soar --local-dir <model store>/dots-tts/dots.tts-soar
```

Then set `paths.dotsModel` in `config/sosie.local.json`. Settings → Voice shows Dots once both are in place.
