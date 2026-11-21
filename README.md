# Ward — Diagnostic training simulator

A real-time medical interview practice app. A student interviews a simulated
patient, takes private notes, submits a diagnosis, and receives a score and
case-specific feedback.

## Run locally

Requires Node.js 20.6 or newer.

```sh
export ANTHROPIC_API_KEY="your-anthropic-api-key"
npm start
```

Open [http://localhost:3000](http://localhost:3000). Model credentials are read
only by the server; do not put provider keys in browser code or commit them.
`ANTHROPIC_API_KEY` is required for Claude patient replies. Install and sign in
to [Wispr Flow](https://wisprflow.ai) on the student's device, then use its
configured shortcut while the chat field is focused to dictate. The ElevenLabs
onboarding flow stores `ELEVENLABS_API_KEY` in the ignored `.env.local` file,
which the start script loads automatically. If a model credential is missing,
the related action returns a visible setup error instead of silently
substituting simulated output.

## AI structure

- **Patient conversation model** — `src/providers.js` calls Anthropic's
  Messages API with `claude-haiku-5-5` by default. Override with
  `PATIENT_CHAT_MODEL`. If generated profiles exist in `data/patients`, the
  server selects one for each new session and sends its full patient-role
  prompt to Claude; otherwise it uses the built-in sample case. The selected
  profile and server-maintained interview history provide patient continuity.
  Set `ANTHROPIC_BASE_URL` to use a compatible Anthropic endpoint.
- **Patient speech model** — the separate `/api/speech` endpoint uses the
  ElevenLabs JavaScript SDK to synthesize each reply. It defaults to
  `eleven_flash_v2_5` and voice `JBFqnCBsd6RMkjVDRZzb`; override them with
  `ELEVENLABS_MODEL_ID` and `ELEVENLABS_VOICE_ID`. The student can play speech
  on demand using **Listen**; chat remains text-first.
- **Student voice input** — focus the chat composer and use the Wispr Flow
  desktop app's configured dictation shortcut. Wispr Flow inserts the recognized
  text directly into the field; the student can review/edit it before sending.
  The simulator does not capture or upload student audio.
- **Session API** — `server.js` owns short-lived interview history and exposes
  `POST /api/sessions`, `POST /api/chat`, `POST /api/speech`, and
  `POST /api/diagnosis`. Notes stay in the browser during the interview and
  are sent to the server only with the final diagnosis for grading; they are
  not included in patient prompts.
- **Assessment** — after submission, `gradeEncounter` in `src/providers.js`
  sends the case reference, interview transcript, student notes, and diagnosis
  to Claude. Claude grades diagnosis, clinical reasoning, evidence gathering,
  and whether relevant alternative diagnoses—especially dangerous mimics—were
  reasonably considered or lowered by evidence. It returns rubric scores plus
  specific strengths, gaps, and follow-up suggestions. It should not penalize
  students for failing to list every conceivable diagnosis. This is formative
  educational feedback, not a validated clinical assessment.

Claude uses the Anthropic Messages API and patient speech uses the ElevenLabs
SDK. Student dictation is provided by the Wispr Flow desktop application;
there is no student-audio transcription API in the simulator. The UI and
session API do not depend on a specific model vendor.

## Interview flow

1. Review the patient file: name, age, sex, reason for visit, and previous
   conditions.
2. Select **See patient** to start the 15-minute encounter. The simulated
   patient is heard through generated speech; the conversation is not displayed
   as text. Use Wispr Flow to dictate questions into the question field and
   keep private notes alongside the interview.
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
