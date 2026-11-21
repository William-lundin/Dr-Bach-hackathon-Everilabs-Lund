import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from build_patient import MAX_PROFILE_TOKENS, validate_patient_profile


class ValidatePatientProfileTests(unittest.TestCase):
    def test_complete_profile_is_accepted(self):
        profile = "\n".join(
            [
                "# Patient Profile: Casey Taylor (ID: TEST001)",
                '- **Opening Line:** "I have had a headache since this morning."',
                "- **Primary Diagnosis:** Migraine without aura",
                "- **Answer Key (never state aloud as the patient):** Migraine; treat symptoms.",
            ]
        )
        validate_patient_profile(profile, "TEST001")

    def test_truncated_profile_is_rejected_with_missing_fields(self):
        profile = "\n".join(
            [
                "# Patient Profile: Diane Baker (ID: D2N168)",
                '- **Opening Line:** "I felt light-headed yesterday."',
                "- **Associated Symptoms (Positive):** headache",
            ]
        )
        with self.assertRaisesRegex(
            RuntimeError,
            "D2N168; missing primary diagnosis, answer key",
        ):
            validate_patient_profile(profile, "D2N168")

    def test_profile_token_limit_allows_complete_case_output(self):
        self.assertGreaterEqual(MAX_PROFILE_TOKENS, 4096)


if __name__ == "__main__":
    unittest.main()
