import argparse
import csv
import json
import os
import re
from pathlib import Path
from typing import Optional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = (
    PROJECT_ROOT / "Patient simulator" / "data" / "raw" / "challenge_data"
)
DEFAULT_OUT_DIR = PROJECT_ROOT / "data" / "patients"
DEFAULT_EXTRACTION_PROMPT = (
    PROJECT_ROOT / "Patient simulator" / "prompts" / "extraction_prompt.txt"
)
DEFAULT_MODEL = os.environ.get("PATIENT_CHAT_MODEL") or "claude-haiku-5-5"
MAX_PROFILE_TOKENS = 4096


def load_dotenv_file(path: Path) -> None:
    """Load simple KEY=VALUE entries without overriding the current environment."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key.removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def load_api_environment() -> None:
    # The Node start command loads .env.local. The Python builder must do the
    # same because it runs as a separate process.
    load_dotenv_file(PROJECT_ROOT / ".env.local")
    load_dotenv_file(PROJECT_ROOT / "key.env")


def extract_text_response(response) -> str:
    """Return only the visible text blocks from an Anthropic response."""
    text_parts = []
    for block in response.content:
        block_type = getattr(block, "type", None)
        if block_type is None and isinstance(block, dict):
            block_type = block.get("type")
        if block_type != "text":
            continue

        text = getattr(block, "text", None)
        if text is None and isinstance(block, dict):
            text = block.get("text")
        if isinstance(text, str) and text.strip():
            text_parts.append(text.strip())

    profile = "\n".join(text_parts).strip()
    if not profile:
        raise RuntimeError("Claude returned no visible text profile blocks.")
    return profile


def validate_patient_profile(profile: str, patient_id: str) -> None:
    """Reject incomplete extraction output before it is saved to the dataset."""
    required_fields = (
        ("opening line", r"^\s*-\s*\*\*Opening Line:\*\*\s*.+$"),
        ("primary diagnosis", r"^\s*-\s*\*\*Primary Diagnosis:\*\*\s*.+$"),
        (
            "answer key",
            r"^\s*-\s*\*\*Answer Key(?:\s*\([^)]*\))?:\*\*\s*.+$",
        ),
    )
    missing = [
        name
        for name, pattern in required_fields
        if not re.search(pattern, profile, flags=re.IGNORECASE | re.MULTILINE)
    ]
    if missing:
        raise RuntimeError(
            f"Claude returned an incomplete profile for {patient_id}; "
            f"missing {', '.join(missing)}. The profile was not saved. "
            "Retry this patient with --overwrite."
        )


def load_csv_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def get_join_key(src_rows: list[dict], meta_rows: list[dict]) -> str:
    """ACI-Bench uses 'encounter_id' in challenge files and 'id' in src_experiment files."""
    src_cols = set(src_rows[0].keys())
    meta_cols = set(meta_rows[0].keys())
    if "encounter_id" in src_cols and "encounter_id" in meta_cols:
        return "encounter_id"
    if "id" in src_cols and "id" in meta_cols:
        return "id"
    raise KeyError(f"No common join key found between {src_cols} and {meta_cols}")


def build_all_patients(
    raw_dir: Path,
    out_dir: Path,
    extraction_prompt_path: Path,
    limit: Optional[int] = None,
    overwrite: bool = False,
    model: str = DEFAULT_MODEL,
    dry_run: bool = False,
):
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
    extraction_instructions = extraction_prompt_path.read_text(encoding="utf-8")
    client = None

    index_entries: list[dict] = []
    processed_count = 0

    # Find all *.csv files that do NOT end with _metadata.csv
    src_files = sorted(
        p for p in raw_dir.glob("*.csv") if not p.name.endswith("_metadata.csv")
    )

    for src_file in src_files:
        if limit is not None and processed_count >= limit:
            break

        meta_file = raw_dir / src_file.name.replace(".csv", "_metadata.csv")
        if not meta_file.exists():
            print(f"Skipping {src_file.name}: missing {meta_file.name}")
            continue

        src_rows = load_csv_rows(src_file)
        meta_rows = load_csv_rows(meta_file)
        if not src_rows or not meta_rows:
            continue

        join_key = get_join_key(src_rows, meta_rows)
        meta_by_id = {row[join_key]: row for row in meta_rows}

        for row in src_rows:
            if limit is not None and processed_count >= limit:
                break

            patient_id = row[join_key]
            meta = meta_by_id.get(patient_id, {})
            out_file = out_dir / f"{patient_id}.md"

            if not dry_run:
                index_entry = {
                    "patient_id": patient_id,
                    "file": out_file.name,
                    "dataset": row.get("dataset", ""),
                    "cc": meta.get("cc", ""),
                    "2nd_complaints": meta.get("2nd_complaints", ""),
                    "patient_age": meta.get("patient_age", ""),
                    "patient_gender": meta.get("patient_gender", ""),
                    "patient_firstname": meta.get("patient_firstname", ""),
                    "patient_familyname": meta.get("patient_familyname", ""),
                    "source_file": src_file.name,
                }

                if out_file.exists() and not overwrite:
                    index_entries.append(index_entry)
                    continue

                index_entries.append(index_entry)

            raw_payload = (
                f"ID: {patient_id}\n"
                f"METADATA: {json.dumps(meta, ensure_ascii=False)}\n\n"
                f"DIALOGUE:\n{row.get('dialogue', '')}\n\n"
                f"NOTE:\n{row.get('note', '')}"
            )

            request_payload = {
                "model": model,
                "max_tokens": MAX_PROFILE_TOKENS,
                "system": extraction_instructions,
                "messages": [{"role": "user", "content": raw_payload}],
            }

            if dry_run:
                print(f"--- Request for {patient_id} ({src_file.name}) ---")
                print(json.dumps(request_payload, indent=2, ensure_ascii=False))
                processed_count += 1
                continue

            if client is None:
                import anthropic

                load_api_environment()
                api_key = os.environ.get("ANTHROPIC_API_KEY")
                if not api_key:
                    raise RuntimeError(
                        "ANTHROPIC_API_KEY is not configured. Add it to .env.local "
                        "(preferred) or export it in the shell before running the builder."
                    )
                client = anthropic.Anthropic(api_key=api_key)

            print(f"Converting {patient_id} from {src_file.name}...")
            resp = client.messages.create(**request_payload)

            if getattr(resp, "stop_reason", None) == "max_tokens":
                raise RuntimeError(
                    f"Claude truncated the profile for {patient_id} at the token "
                    "limit. Increase MAX_PROFILE_TOKENS and retry with --overwrite."
                )
            profile = extract_text_response(resp)
            validate_patient_profile(profile, patient_id)
            out_file.write_text(profile + "\n", encoding="utf-8")
            processed_count += 1

    if dry_run:
        print(
            f"Previewed {processed_count} request(s); no API calls were made "
            "and no profiles were written."
        )
        return

    # Save index only for patients whose .md file actually exists
    existing_index = [e for e in index_entries if (out_dir / e["file"]).exists()]
    (out_dir / "index.json").write_text(
        json.dumps(existing_index, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Done! {len(existing_index)} patient profiles ready in {out_dir}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert ACI-Bench CSV files into clean Markdown patient profiles."
    )
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--prompt", type=Path, default=DEFAULT_EXTRACTION_PROMPT
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Max number of new profiles to generate"
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Anthropic model ID (defaults to PATIENT_CHAT_MODEL or the app default)",
    )
    parser.add_argument(
        "--overwrite", action="store_true", help="Overwrite existing patient profiles"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print request data without calling Claude or writing profiles",
    )
    args = parser.parse_args()

    build_all_patients(
        raw_dir=args.raw_dir,
        out_dir=args.out_dir,
        extraction_prompt_path=args.prompt,
        limit=args.limit,
        overwrite=args.overwrite,
        model=args.model,
        dry_run=args.dry_run,
    )