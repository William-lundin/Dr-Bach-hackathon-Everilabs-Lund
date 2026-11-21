import os
from pathlib import Path
import anthropic
from prompt_generator import PatientPromptGenerator

BASE_DIR = Path(__file__).resolve().parents[1]

# 1. Initialize the generator once
generator = PatientPromptGenerator(
    patients_dir=BASE_DIR / "data" / "patients",
    system_template_path=(
        BASE_DIR / "Patient simulator" / "prompts" / "system_patient_role.txt"
    ),
)

# 2. Pick a random patient (optionally excluding previously seen patient IDs)
seen_patients = {"ACI066"}
patient_case = generator.generate_random_prompt(exclude_ids=seen_patients)

print(f"Starting training encounter with patient: {patient_case.patient_id}")
print(f"Chief complaint (for instructor/logs): {patient_case.chief_complaint}\n")

# 3. Chat loop with Claude
client = anthropic.Anthropic()  # Reads ANTHROPIC_API_KEY from environment
messages = []

while True:
    doctor_input = input("Doctor: ")
    if doctor_input.lower() in {"quit", "exit"}:
        break

    messages.append({"role": "user", "content": doctor_input})

    response = client.messages.create(
        model=os.environ.get("PATIENT_CHAT_MODEL") or "claude-haiku-5-5",
        max_tokens=600,
        system=patient_case.system_prompt,
        messages=messages,
    )

    reply = response.content[0].text
    messages.append({"role": "assistant", "content": reply})
    print(f"Patient: {reply}\n")