const test = require("node:test");
const assert = require("node:assert/strict");
const { buildVoiceAgentConfiguration } = require("../src/deepgram-voice");

test("Deepgram Voice Agent settings use Deepgram audio and the current patient prompt", () => {
  const patientCase = {
    patient: {
      opening: "I have had a headache since this morning.",
      systemPrompt: "Role instructions with the generated patient profile.",
    },
  };
  const configuration = buildVoiceAgentConfiguration(patientCase, {
    DEEPGRAM_API_KEY: "deepgram-test-key",
    ANTHROPIC_API_KEY: "anthropic-test-key",
    ANTHROPIC_BASE_URL: "https://gateway.example/v1",
    PATIENT_CHAT_MODEL: "claude-test-model",
  });

  assert.equal(configuration.apiKey, "deepgram-test-key");
  assert.equal(configuration.settings.mip_opt_out, true);
  assert.deepEqual(configuration.settings.audio.input, {
    encoding: "linear16",
    sample_rate: 16000,
  });
  assert.equal(
    configuration.settings.agent.listen.provider.model,
    "flux-general-en",
  );
  assert.equal(
    configuration.settings.agent.think.provider.type,
    "anthropic",
  );
  assert.equal(
    configuration.settings.agent.think.provider.model,
    "claude-test-model",
  );
  assert.equal(
    Object.hasOwn(configuration.settings.agent.think.provider, "temperature"),
    false,
  );
  assert.equal(
    configuration.settings.agent.think.prompt,
    "Role instructions with the generated patient profile.",
  );
  assert.equal(
    configuration.settings.agent.think.endpoint.headers["x-api-key"],
    "anthropic-test-key",
  );
  assert.deepEqual(configuration.settings.agent.think.endpoint.headers, {
    "x-api-key": "anthropic-test-key",
  });
  assert.equal(
    configuration.settings.agent.think.endpoint.url,
    "https://gateway.example/v1/messages",
  );
  assert.equal(
    configuration.settings.agent.speak.provider.model,
    "flux-alexis-en",
  );
  assert.equal(
    configuration.settings.agent.greeting,
    patientCase.patient.opening,
  );
});

test("Voice Agent configuration fails explicitly when either server key is missing", () => {
  const patientCase = { patient: { opening: "Hello", systemPrompt: "Role" } };
  assert.throws(
    () => buildVoiceAgentConfiguration(patientCase, {}),
    /DEEPGRAM_API_KEY is not configured/,
  );
  assert.throws(
    () =>
      buildVoiceAgentConfiguration(patientCase, {
        DEEPGRAM_API_KEY: "deepgram-test-key",
      }),
    /ANTHROPIC_API_KEY is not configured/,
  );
});
