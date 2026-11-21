from dataclasses import dataclass
from pathlib import Path
import json
import random
from typing import Optional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATIENTS_DIR = PROJECT_ROOT / "data" / "patients"
DEFAULT_SYSTEM_TEMPLATE = (
    PROJECT_ROOT / "Patient simulator" / "prompts" / "system_patient_role.txt"
)


@dataclass
class PatientPrompt:
    patient_id: str
    system_prompt: str
    chief_complaint: str
    metadata: dict


class PatientPromptGenerator:
    def __init__(
        self,
        patients_dir: str | Path = DEFAULT_PATIENTS_DIR,
        system_template_path: str | Path = DEFAULT_SYSTEM_TEMPLATE,
    ):
        self.patients_dir = Path(patients_dir)
        self.system_template_path = Path(system_template_path)

        if not self.system_template_path.exists():
            raise FileNotFoundError(
                f"System prompt template not found: {self.system_template_path}"
            )

        self.system_template = self.system_template_path.read_text(encoding="utf-8")
        self.index = self._load_index()

    def _load_index(self) -> list[dict]:
        """Loads index.json if available, otherwise scans *.md files directly."""
        index_path = self.patients_dir / "index.json"
        if index_path.exists():
            return json.loads(index_path.read_text(encoding="utf-8"))

        # Fallback if .md files were created manually without index.json
        md_files = sorted(self.patients_dir.glob("*.md"))
        return [{"patient_id": f.stem, "file": f.name, "cc": ""} for f in md_files]

    def generate_random_prompt(
        self,
        exclude_ids: Optional[set[str]] = None,
        dataset_filter: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> PatientPrompt:
        """
        Randomly selects a patient and returns a ready-to-use system prompt for Claude.

        Args:
            exclude_ids: Set of patient IDs to exclude (e.g., already completed cases).
            dataset_filter: Optional filter, e.g., 'aci', 'virtassist', or 'virtscribe'.
            seed: Optional random seed for reproducible testing.
        """
        candidates = self.index

        if exclude_ids:
            candidates = [p for p in candidates if p["patient_id"] not in exclude_ids]

        if dataset_filter:
            candidates = [p for p in candidates if p.get("dataset") == dataset_filter]

        if not candidates:
            raise ValueError("No matching patients left to select from.")

        rng = random.Random(seed)
        chosen = rng.choice(candidates)

        return self.generate_prompt_by_id(chosen["patient_id"], metadata=chosen)

    def generate_prompt_by_id(
        self, patient_id: str, metadata: Optional[dict] = None
    ) -> PatientPrompt:
        """Loads a specific patient profile and builds the full system prompt."""
        meta = metadata or next(
            (p for p in self.index if p["patient_id"] == patient_id),
            {"patient_id": patient_id, "cc": ""},
        )
        filename = meta.get("file") or f"{patient_id}.md"
        if (
            not isinstance(filename, str)
            or Path(filename).name != filename
            or not filename.endswith(".md")
        ):
            raise ValueError(f"Invalid patient profile filename: {filename}")

        profile_path = self.patients_dir / filename
        if not profile_path.exists():
            raise FileNotFoundError(f"Patient profile not found: {profile_path}")

        profile_text = profile_path.read_text(encoding="utf-8")
        system_prompt = self.system_template.replace("{patient_profile}", profile_text)

        return PatientPrompt(
            patient_id=patient_id,
            system_prompt=system_prompt,
            chief_complaint=meta.get("cc", ""),
            metadata=meta,
        )