const test = require("node:test");
const assert = require("node:assert/strict");
const { getCase, scoreDiagnosis } = require("../src/diagnostics");

test("case lookup returns the configured training case", () => {
  assert.equal(getCase("migraine").diagnosis.label, "Migraine without aura");
  assert.equal(getCase("missing"), null);
});

test("diagnosis score rewards a matching answer and interview coverage", () => {
  const caseData = getCase("migraine");
  const result = scoreDiagnosis(caseData, "Migraine", [
    { role: "user", content: "Does bright light bother you?" },
    { role: "user", content: "Do you feel nauseated?" },
    { role: "user", content: "Have you had similar headaches before?" },
  ]);
  assert.equal(result.diagnosisCorrect, true);
  assert.ok(result.score > 60);
  assert.ok(result.coveredFindings.length > 0);
  assert.equal(result.expectedDiagnosis, caseData.diagnosis.label);
});

test("incorrect answers do not receive diagnosis points", () => {
  const result = scoreDiagnosis(getCase("migraine"), "Sinusitis", []);
  assert.equal(result.diagnosisCorrect, false);
  assert.equal(result.score, 0);
  assert.equal(result.coveredFindings.length, 0);
});
