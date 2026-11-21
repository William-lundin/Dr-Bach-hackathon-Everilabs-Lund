const cases = [
  {
    id: "migraine",
    title: "A recurring headache",
    patient: {
      name: "Jordan Lee",
      age: 24,
      opening:
        "I've had this really bad headache since this morning. It feels worse than the headaches I usually get.",
      profile:
        "You are Jordan Lee, a 24-year-old graduate student. You came to the clinic because of a severe headache that began gradually this morning. It is on the right side, throbbing, and gets worse with movement. Bright light and loud sounds bother you, and you feel nauseated but have not vomited. You have had similar episodes a few times a year since your late teens. You have no fever, neck stiffness, weakness, numbness, vision loss, recent head injury, or sudden thunderclap onset. You took ibuprofen with little relief. You are worried because this episode is more intense than usual. Answer only what the student asks, in natural first-person language. Do not volunteer the diagnosis, medical terminology, or a full list of symptoms. Never invent red flags. Stay in character as the patient.",
    },
    diagnosis: {
      label: "Migraine without aura",
      aliases: ["migraine", "migraine without aura"],
      keyFindings: [
        "one-sided throbbing headache",
        "light or sound sensitivity",
        "nausea",
        "recurrent similar episodes",
        "absence of sudden onset or neurologic red flags",
      ],
      interviewSignals: [
        ["where", "location", "one side", "which side", "throb", "puls", "describe the pain"],
        ["light", "bright", "sound", "noise", "loud"],
        ["nausea", "nauseated", "sick", "vomit", "throw up"],
        ["before", "previous", "similar", "happened", "other headaches"],
        ["fever", "neck", "weak", "numb", "vision", "injury", "sudden", "worst"],
      ],
      explanation:
        "The recurrent unilateral, throbbing headache with light/sound sensitivity and nausea is most consistent with migraine. The gradual onset and absence of neurologic red flags make an emergency secondary cause less likely in this case.",
    },
  },
];

function getCase(caseId) {
  return cases.find((candidate) => candidate.id === caseId) ?? null;
}

function scoreDiagnosis(caseData, submittedDiagnosis, conversation = []) {
  const answer = submittedDiagnosis.trim().toLowerCase();
  const isCorrect = caseData.diagnosis.aliases.some((alias) =>
    answer.includes(alias),
  );
  const coveredFindings = caseData.diagnosis.keyFindings.filter((finding) => {
    const index = caseData.diagnosis.keyFindings.indexOf(finding);
    const signals = caseData.diagnosis.interviewSignals[index];
    return conversation
      .filter((turn) => turn.role === "user")
      .some((turn) =>
        signals.some((signal) => turn.content.toLowerCase().includes(signal)),
      );
  });
  const historyPoints = Math.round(
    (coveredFindings.length / caseData.diagnosis.keyFindings.length) * 40,
  );
  const score = Math.min(100, (isCorrect ? 60 : 0) + historyPoints);

  return {
    score,
    diagnosisCorrect: isCorrect,
    expectedDiagnosis: caseData.diagnosis.label,
    keyFindings: caseData.diagnosis.keyFindings,
    coveredFindings,
    explanation: caseData.diagnosis.explanation,
    feedback: isCorrect
      ? "Good work identifying the most likely diagnosis. Review the key findings below and consider whether your history covered important warning signs."
      : "Your submitted diagnosis does not match the leading diagnosis in this case. Review the history clues below and consider what additional questions would help distinguish the possibilities.",
  };
}

module.exports = { getCase, scoreDiagnosis };
