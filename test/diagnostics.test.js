const test = require("node:test");
const assert = require("node:assert/strict");
const { getCase } = require("../src/diagnostics");

test("case lookup returns the configured training case", () => {
  const caseData = getCase("migraine");
  assert.equal(caseData.diagnosis.label, "Migraine without aura");
  assert.equal(caseData.patient.sex, "Female");
  assert.equal(caseData.patient.reasonForVisit.length > 0, true);
  assert.ok(caseData.patient.previousConditions.length > 0);
  assert.equal(getCase("missing"), null);
});
