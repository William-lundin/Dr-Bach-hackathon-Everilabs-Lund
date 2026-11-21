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
  `PATIENT_CHAT_MODEL`. The case profile and server-maintained interview
  history provide patient continuity; the model is instructed to stay in
  character and reveal only information the student asks about. Set
  `ANTHROPIC_BASE_URL` to use a compatible Anthropic endpoint.
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
  `POST /api/diagnosis`. Notes remain in the
  browser and are not included in patient prompts.
- **Scoring** — `src/diagnostics.js` scores the submitted diagnosis and
  interview coverage against the selected case rubric. This first scaffold
  uses a deterministic rubric and one sample case; extend the case catalog and
  rubric before using it for formal assessment.

Claude uses the Anthropic Messages API and patient speech uses the ElevenLabs
SDK. Student dictation is provided by the Wispr Flow desktop application;
there is no student-audio transcription API in the simulator. The UI and
session API do not depend on a specific model vendor.

## Verify

```sh
npm test
```

## Generate patient profiles

The optional Python pipeline reads only the human-transcribed `challenge_data`
files by default, avoiding duplicate ASR variants. It writes profiles to
`data/patients` and reads its extraction and role prompts from
`Patient simulator/prompts`. Install the Python dependency and set
`ANTHROPIC_API_KEY`, then run:

```sh
python -m pip install -r requirements.txt
python src/build_patient.py --dry-run --limit 1
python src/build_patient.py --limit 3
```

The dry run prints the exact request (model, system prompt, and patient data)
without making an API call or writing output files.
The model defaults to `PATIENT_CHAT_MODEL` or `claude-haiku-5-5`; pass
`--model` to override it. Paths can be overridden with `--raw-dir`, `--out-dir`,
and `--prompt`.
