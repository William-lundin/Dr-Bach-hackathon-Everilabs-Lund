const test = require("node:test");
const assert = require("node:assert/strict");
const { generatePatientReply, gradeEncounter } = require("../src/providers");

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
    assert.equal(requestOptions.headers["anthropic-version"], "2026-10-21");
    const body = JSON.parse(requestOptions.body);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal("temperature" in body, false);
    assert.equal(body.system, "Dataset role prompt with full generated profile.");
    assert.equal(body.output_config, undefined);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content, "When did it start?");
  } finally {
    global.fetch = originalFetch;
  }
});

test("encounter grading sends notes and transcript and validates rubric scores", async () => {
  const originalFetch = global.fetch;
  let requestUrl;
  let requestOptions;
  const grade = {
    score: 82,
    diagnosisCorrect: true,
    diagnosisAssessment: "Migraine is the leading diagnosis.",
    categoryScores: {
      diagnosis: 32,
      clinicalReasoning: 20,
      differentialAndExclusion: 22,
      evidenceGathering: 8,
    },
    differentials: [
      {
        diagnosis: "Subarachnoid hemorrhage",
        relevance: "high",
        status: "partially addressed",
        evidence: "Gradual onset is documented, but peak time and neurologic symptoms were not clearly addressed.",
        nextStep: "Clarify time to peak and ask about focal neurologic symptoms.",
      },
    ],
    strengths: ["Identified a recurrent, unilateral headache pattern."],
    improvements: ["Document key red-flag negatives explicitly."],
    summary: "Good leading diagnosis; strengthen exclusion of urgent alternatives.",
  };
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: `Here is the assessment:\n\`\`\`json\n${JSON.stringify(grade)}\n\`\`\`` }],
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
        ANALYSIS_MODEL: undefined,
      },
      async () => {
        const result = await gradeEncounter(
          {
            patient: {
              profile: "Hidden diagnosis: migraine.",
              systemPrompt: "Role and full profile.",
            },
          },
          "Migraine",
          "Unilateral, throbbing; no sudden onset.",
          [
            { role: "assistant", content: "My head hurts." },
            { role: "user", content: "Did it start suddenly?" },
          ],
        );
        assert.equal(result.score, 82);
        assert.equal(result.differentials[0].diagnosis, "Subarachnoid hemorrhage");
      },
    );
    assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(requestOptions.body);
    assert.equal(body.model, "claude-sonnet-5-5");
    const submission = JSON.parse(body.messages[0].content);
    assert.equal(submission.submittedDiagnosis, "Migraine");
    assert.equal(submission.studentNotes, "Unilateral, throbbing; no sudden onset.");
    assert.deepEqual(submission.interviewTranscript, [
      { speaker: "Patient", text: "My head hurts." },
      { speaker: "Student", text: "Did it start suddenly?" },
    ]);
    assert.equal(body.system.includes("prioritizing dangerous mimics"), true);
    assert.equal(body.system.includes("at most 3 differentials"), true);
    assert.equal(body.system.includes("at most 2 strengths and 2 improvements"), true);
    assert.equal(body.max_tokens, 3000);
    assert.equal(body.output_config.format.type, "json_schema");
    assert.equal(body.output_config.format.schema.type, "object");
    assert.equal(
      "minimum" in body.output_config.format.schema.properties.score,
      false,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("encounter grader rejects inconsistent rubric totals", async () => {
  const originalFetch = global.fetch;
  const invalidGrade = {
    score: 100,
    diagnosisCorrect: true,
    diagnosisAssessment: "Correct.",
    categoryScores: {
      diagnosis: 35,
      clinicalReasoning: 25,
      differentialAndExclusion: 30,
      evidenceGathering: 9,
    },
    differentials: [],
    strengths: [],
    improvements: [],
    summary: "Good.",
  };
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(invalidGrade) }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    await withEnvironment(
      {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: undefined,
        PATIENT_CHAT_MODEL: undefined,
      },
      async () => {
        await assert.rejects(
          gradeEncounter(
            { patient: { profile: "case" } },
            "diagnosis",
            "notes",
            [],
          ),
          /inconsistent rubric scores/,
        );
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});
