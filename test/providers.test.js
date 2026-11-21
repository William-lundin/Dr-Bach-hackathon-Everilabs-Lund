const test = require("node:test");
const assert = require("node:assert/strict");
const { generatePatientReply } = require("../src/providers");

function withEnvironment(values, callback) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("patient replies use the configured Claude model and Anthropic Messages API", async () => {
  const originalFetch = global.fetch;
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "My head has been hurting since this morning." }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await withEnvironment(
      {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: undefined,
        PATIENT_CHAT_MODEL: undefined,
      },
      async () => {
        const reply = await generatePatientReply(
          {
            patient: {
              profile: "Test profile.",
              systemPrompt: "Dataset role prompt with full generated profile.",
            },
          },
          [{ role: "user", content: "When did it start?" }],
        );
        assert.equal(reply, "My head has been hurting since this morning.");
      },
    );
    assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(requestOptions.headers["x-api-key"], "test-anthropic-key");
    const body = JSON.parse(requestOptions.body);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal(body.system, "Dataset role prompt with full generated profile.");
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content, "When did it start?");
  } finally {
    global.fetch = originalFetch;
  }
});
