const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadPatientCases } = require("../src/patient-dataset");
const { generatePatientReply } = require("../src/providers");

test("generated patient profiles become UI cases and Claude system prompts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patient-dataset-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const patientsDirectory = path.join(root, "patients");
  await mkdir(patientsDirectory);
  const profile = [
    "# Patient Profile: Casey Taylor (ID: TEST001)",
    "",
    "## 1. Role & Persona",
    "- **Demographics:** Casey Taylor; Age: 42; Gender: nonbinary",
    "",
    "## 2. Chief Complaint & Opening Line",
    "- **Chief Complaint:** A recurring headache",
    '- **Opening Line:** "I have had a headache since this morning."',
    "",
    "## 4. Background",
    "- **Past Medical & Surgical History:** Asthma; hypertension",
    "",
    "## 5. FOR SIMULATION ONLY: Objective Findings & Results",
    "- **Primary Diagnosis:** Migraine without aura",
    "- **Answer Key (never state aloud as the patient):** Migraine without aura; treat symptoms.",
  ].join("\n");
  await writeFile(path.join(patientsDirectory, "TEST001.md"), profile);
  const legacyProfile = [
    "# Patient Profile: Jamie Morgan (ID: TEST002)",
    "- **Demographics:** Jamie Morgan; Age: 30; Gender: female",
    '- **Chief Complaint:** "A cough"',
    '- **Opening Line:** "I have had a cough for a few days."',
    "- **Answer Key (never state aloud as the patient):** Asthma exacerbation; adjust treatment.",
  ].join("\n");
  await writeFile(path.join(patientsDirectory, "TEST002.md"), legacyProfile);
  await writeFile(
    path.join(patientsDirectory, "index.json"),
    JSON.stringify([
      {
        patient_id: "TEST001",
        file: "TEST001.md",
        dataset: "test",
        cc: "metadata complaint",
        "2nd_complaints": "metadata history",
      },
      {
        patient_id: "TEST002",
        file: "TEST002.md",
      },
    ]),
  );
  const roleTemplatePath = path.join(root, "role.txt");
  const roleTemplate = "Role instructions\nPATIENT PROFILE:\n{patient_profile}";
  await writeFile(roleTemplatePath, roleTemplate);

  const [patientCase, legacyCase] = await loadPatientCases({
    patientsDirectory,
    rolePromptPath: roleTemplatePath,
  });

  assert.equal(patientCase.id, "TEST001");
  assert.equal(patientCase.patient.name, "Casey Taylor");
  assert.equal(patientCase.patient.age, 42);
  assert.equal(patientCase.patient.sex, "nonbinary");
  assert.equal(patientCase.patient.reasonForVisit, "A recurring headache");
  assert.deepEqual(patientCase.patient.previousConditions, [
    "Asthma",
    "hypertension",
  ]);
  assert.equal(
    patientCase.patient.opening,
    "I have had a headache since this morning.",
  );
  assert.equal(
    patientCase.patient.systemPrompt,
    roleTemplate.replace("{patient_profile}", profile),
  );
  assert.equal(patientCase.diagnosis.label, "Migraine without aura");
  assert.equal(legacyCase.diagnosis.label, "Asthma exacerbation");

  const originalFetch = global.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "It started today." }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    await generatePatientReply(patientCase, [
      { role: "user", content: "When did it start?" },
    ]);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
  assert.equal(requestBody.system, patientCase.patient.systemPrompt);
});

test("missing generated data leaves the sample-case fallback available", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "patient-dataset-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await loadPatientCases({ patientsDirectory: root }), []);
});
