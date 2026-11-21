# Ward — Diagnostic training simulator

A real-time medical interview practice app. A student interviews a simulated
patient, takes private notes, submits a diagnosis, and receives a score and
case-specific feedback.

## Run locally

Requires Node.js 18 or newer. The app has no package dependencies.

```sh
export AI_API_KEY="your-provider-api-key"
# Optional: set this for an OpenAI-compatible provider endpoint.
export AI_BASE_URL="https://api.openai.com/v1"
npm start
```

Open [http://localhost:3000](http://localhost:3000). Model credentials are read
only by the server; do not put provider keys in browser code or commit them.
`AI_API_KEY` is required for patient replies and generated speech. If it is not
configured, those actions return a visible setup error instead of silently
substituting simulated output.

## AI structure

- **Patient conversation model** — `src/providers.js` calls the configured
  OpenAI-compatible `/chat/completions` endpoint. The case profile and
  server-maintained interview history provide patient continuity; the model is
  instructed to stay in character and reveal only information the student asks
  about. Select its model with `PATIENT_CHAT_MODEL`.
- **Patient speech model** — the separate `/audio/speech` endpoint synthesizes
  each patient reply. Select its model and voice with `PATIENT_SPEECH_MODEL`
  and `PATIENT_SPEECH_VOICE`. The student can play speech on demand using
  **Listen**; chat remains text-first.
- **Session API** — `server.js` owns short-lived interview history and exposes
  `POST /api/sessions`, `POST /api/chat`, `POST /api/speech`, and
  `POST /api/diagnosis`. Notes remain in the browser and are not included in
  patient prompts.
- **Scoring** — `src/diagnostics.js` scores the submitted diagnosis and
  interview coverage against the selected case rubric. This first scaffold
  uses a deterministic rubric and one sample case; extend the case catalog and
  rubric before using it for formal assessment.

The provider adapter expects OpenAI-compatible chat-completion and speech
endpoints. Different providers can be integrated by replacing the two
functions in `src/providers.js`; the UI and session API do not depend on a
specific model vendor.

## Verify

```sh
npm test
```
