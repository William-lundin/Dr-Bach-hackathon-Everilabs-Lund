# Ward — Diagnostic training simulator

A real-time medical interview practice app. A student interviews a simulated
patient, takes private notes, submits a diagnosis, and receives a score and
case-specific feedback.

## Run locally

Requires Node.js 20.6 or newer.

```sh
# Create .env.local in the repository root and add:
# ANTHROPIC_API_KEY=your-anthropic-key
# DEEPGRAM_API_KEY=your-deepgram-key
npm start
```

Open [http://localhost:3000](http://localhost:3000). Model credentials are read
by the server; never put provider keys in browser code or commit them.
`ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` are both required for voice calls.
The `start` script loads `.env.local`.

## AI structure

- **Continuous voice call** — the browser captures microphone audio with an
  AudioWorklet and streams 16 kHz PCM over the same-origin `/api/voice`
  WebSocket. The server relays it to Deepgram Voice Agent, then streams
  24 kHz patient audio back. Deepgram Flux models handle transcription and
  speech; the agent uses Anthropic as its reasoning provider. The default
  models are `flux-general-en`, `flux-alexis-en` (speed 1, expressivity 0),
  and `claude-haiku-5-5`;
  override them with `DEEPGRAM_STT_MODEL`, `DEEPGRAM_TTS_MODEL`, and
  `PATIENT_CHAT_MODEL`.
- **Patient role and continuity** — the server sends the selected case's full
  patient-role prompt to the Voice Agent and records recognized user and
  patient turns in the interview session. Generated profiles in
  `data/patients` are selected for new sessions; otherwise the built-in sample
  case is used. `ANTHROPIC_BASE_URL` can point to an Anthropic-compatible
  Messages API endpoint.
- **Credentials and data** — the Deepgram API key and Anthropic key stay out
  of browser code. The Anthropic key is provided to Deepgram in the Voice
  Agent's custom Anthropic endpoint configuration so the agent can call the
  Messages API. The settings request Deepgram's `mip_opt_out` option. Audio,
  transcripts, and case prompts are still sent to Deepgram and Anthropic to
  operate the simulation; do not use real patient-identifying information.
- **Session API** — `server.js` owns short-lived interview history and exposes
  `POST /api/sessions`, `POST /api/chat` (text-only compatibility),
  `WS /api/voice`, and `POST /api/diagnosis`. Notes remain in the browser
  during the interview and are submitted only for final assessment; they are
  not included in patient prompts.
- **Assessment** — after submission, `gradeEncounter` in `src/providers.js`
  sends the case reference, interview transcript, student notes, and diagnosis
  to Claude. Claude grades diagnosis, clinical reasoning, evidence gathering,
  and whether relevant alternative diagnoses—especially dangerous mimics—were
  reasonably considered or lowered by evidence. It returns rubric scores plus
  specific strengths, gaps, and follow-up suggestions. It should not penalize
  students for failing to list every conceivable diagnosis. This is formative
  educational feedback, not a validated clinical assessment or a replacement
  for case-specific scoring rubrics.

Voice calls require microphone permission and a browser that supports
AudioWorklet. The microphone stream is active for the duration of the
interview; use headphones to reduce audio feedback. Typed messages are also
sent through the same Voice Agent session.

## Interview flow

1. Review the patient file: name, age, sex, reason for visit, and previous
   conditions.
2. Select **See patient** and allow microphone access to start the 15-minute
   voice encounter. Speak naturally; the patient responds aloud and can be
   interrupted. You can also type a message into the composer. Keep private
   notes alongside the interview.
3. Select **Diagnose & finish** (or wait for the timer) to enter a diagnosis and
   receive case feedback.

## Verify

```sh
npm test
```

## Generate and use dataset patient profiles

The optional Python pipeline reads only the human-transcribed `challenge_data`
files by default, avoiding duplicate ASR variants. It writes profiles to
`data/patients`; the Node app reads that same directory and uses the generated
role prompt when calling Claude. Install the Python dependency in a virtual
environment and export `ANTHROPIC_API_KEY` and, if needed,
`PATIENT_CHAT_MODEL` in the same shell:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export ANTHROPIC_API_KEY="your-anthropic-api-key"
python src/build_patient.py --dry-run --limit 1
python src/build_patient.py --limit 3
npm start
```

The dry run prints the exact request (model, system prompt, and patient data)
without making an API call or writing output files.
The model defaults to `PATIENT_CHAT_MODEL` or `claude-haiku-5-5`; pass `--model`
to override it. Paths can be overridden with `--raw-dir`, `--out-dir`, and
`--prompt`. The app uses the generated dataset after profiles have been
created; restart the server after rebuilding profiles. Without generated
profiles it continues to use the built-in sample case.

The Python builder reads `ANTHROPIC_API_KEY` from the current shell, then falls
back to the repository's `.env.local` or `key.env` file. It does not overwrite
an environment variable already exported by your shell. Before generating, you
can confirm setup without using API credits by running `--dry-run`.
Generated responses are checked for the opening line, primary diagnosis, and
answer key before they are saved. If a previous run left a truncated profile
(for example `D2N168.md`), regenerate it with:

```sh
python src/build_patient.py --overwrite --limit 1
```

The app logs and skips malformed dataset profiles rather than failing to start
all patient sessions because of one incomplete file.
