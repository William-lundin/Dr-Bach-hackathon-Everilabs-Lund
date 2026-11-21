const cases = [
  {
    id: "migraine",
    title: "A recurring headache",
    patient: {
      name: "Jordan Lee",
      age: 24,
      sex: "Female",
      reasonForVisit: "A more severe headache than usual, beginning this morning.",
      previousConditions: [
        "Occasional similar headaches since late teens",
        "No other known chronic conditions",
      ],
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

module.exports = { getCase };
