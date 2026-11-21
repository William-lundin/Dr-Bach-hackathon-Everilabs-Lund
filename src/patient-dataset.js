const { randomInt } = require("node:crypto");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");

const defaultPatientsDirectory = path.resolve(__dirname, "..", "data", "patients");
const defaultRolePromptPath = path.resolve(
  __dirname,
  "..",
  "Patient simulator",
  "prompts",
  "system_patient_role.txt",
);

function readField(profile, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = profile.match(
    new RegExp(
      `^\\s*-\\s*\\*\\*${escapedLabel}:?\\*\\*:?\\s*(.*?)\\s*$`,
      "im",
    ),
  );
  return match?.[1].trim().replace(/^["']|["']$/g, "") || "";
}

function readAnswerKey(profile) {
  const match = profile.match(
    /^\s*-\s*\*\*Answer Key(?:\s*\([^)]*\))?:?\*\*:?[\t ]*(.*?)\s*$/im,
  );
  return match?.[1].trim() || "";
}

function parsePatientCase(entry, profile, roleTemplate) {
  const heading = profile.match(/^#\s+Patient Profile:\s*(.*?)\s+\(ID:\s*([^)]+)\)/m);
  const patientId = String(entry.patient_id || "").trim();
  if (!patientId) {
    throw new Error("Patient index entry is missing patient_id.");
  }
  if (heading?.[2] && heading[2].trim() !== patientId) {
    throw new Error(`Patient profile ID does not match index entry: ${patientId}`);
  }

  const demographics = readField(profile, "Demographics");
  const ageMatch = demographics.match(/\bAge:\s*(\d{1,3})\b/i);
  const genderMatch = demographics.match(/\bGender:\s*([^;,.]+)/i);
  const name =
    heading?.[1]?.trim() ||
    [entry.patient_firstname, entry.patient_familyname].filter(Boolean).join(" ") ||
    patientId;
  const chiefComplaint = readField(profile, "Chief Complaint") || entry.cc || "";
  const opening = readField(profile, "Opening Line");
  const history =
    readField(profile, "Past Medical & Surgical History") ||
    entry["2nd_complaints"] ||
    "";
  const previousConditions = history
    .split(/[;\n]/)
    .map((condition) => condition.trim())
    .filter((condition) => condition && !/^none\.?$/i.test(condition));
  const answerKey = readAnswerKey(profile);
  const primaryDiagnosis =
    readField(profile, "Primary Diagnosis") ||
    answerKey.split(/[.;\n]/, 1)[0].replace(/^Diagnosis:\s*/i, "").trim();

  if (!opening) {
    throw new Error(`Patient profile ${patientId} is missing its opening line.`);
  }
  if (!primaryDiagnosis) {
    throw new Error(`Patient profile ${patientId} is missing its answer key.`);
  }

  return {
    id: patientId,
    title: name,
    patient: {
      name,
      age: ageMatch ? Number(ageMatch[1]) : Number(entry.patient_age) || null,
      sex: genderMatch?.[1].trim() || entry.patient_gender || "Not specified",
      reasonForVisit: chiefComplaint,
      previousConditions,
      opening,
      profile,
      systemPrompt: roleTemplate.replace("{patient_profile}", profile),
    },
    diagnosis: {
      label: primaryDiagnosis,
      aliases: [primaryDiagnosis],
      keyFindings: [],
      interviewSignals: [],
      explanation: answerKey || primaryDiagnosis,
    },
  };
}

async function loadPatientCases({
  patientsDirectory = defaultPatientsDirectory,
  rolePromptPath = defaultRolePromptPath,
} = {}) {
  let entries;
  try {
    const indexContent = await readFile(
      path.join(patientsDirectory, "index.json"),
      "utf8",
    );
    entries = JSON.parse(indexContent);
    if (!Array.isArray(entries)) {
      throw new Error("Patient index must contain a JSON array.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const files = await readdir(patientsDirectory);
      entries = files
        .filter((file) => file.endsWith(".md"))
        .sort()
        .map((file) => ({ patient_id: path.basename(file, ".md"), file }));
    } catch (directoryError) {
      if (directoryError.code === "ENOENT") return [];
      throw directoryError;
    }
  }

  if (!entries.length) return [];
  const roleTemplate = await readFile(rolePromptPath, "utf8");
  if (!roleTemplate.includes("{patient_profile}")) {
    throw new Error("Patient role prompt is missing {patient_profile}.");
  }

  const cases = [];
  for (const entry of entries) {
    const patientId = entry?.patient_id || "unknown";
    try {
      if (!entry || typeof entry.patient_id !== "string") {
        throw new Error("Patient index contains an invalid entry.");
      }
      const filename = entry.file || `${entry.patient_id}.md`;
      if (
        typeof filename !== "string" ||
        path.basename(filename) !== filename ||
        !filename.endsWith(".md")
      ) {
        throw new Error(`Invalid patient profile filename for ${entry.patient_id}.`);
      }
      const profile = await readFile(path.join(patientsDirectory, filename), "utf8");
      cases.push(parsePatientCase(entry, profile, roleTemplate));
    } catch (error) {
      console.warn(
        `Skipping patient profile ${patientId}: ${error.message}`,
      );
    }
  }
  return cases;
}

function createPatientDataset(options) {
  let casesPromise;
  return async function getRandomPatientCase() {
    const cases = casesPromise
      ? await casesPromise
      : await loadPatientCases(options);
    if (cases.length && !casesPromise) {
      casesPromise = Promise.resolve(cases);
    }
    return cases.length ? cases[randomInt(cases.length)] : null;
  };
}

module.exports = { createPatientDataset, loadPatientCases };
