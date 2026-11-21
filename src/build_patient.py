import argparse
import csv
import json
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = (
    PROJECT_ROOT / "Patient simulator" / "data" / "raw" / "challenge_data"
)
DEFAULT_OUT_DIR = PROJECT_ROOT / "data" / "patients"
DEFAULT_EXTRACTION_PROMPT = (
    PROJECT_ROOT / "Patient simulator" / "prompts" / "extraction_prompt.txt"
)
DEFAULT_MODEL = os.environ.get("PATIENT_CHAT_MODEL") or "claude-haiku-5-5"


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
    limit: int | None = None,
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
        if dry_run and limit is not None and processed_count >= limit:
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
            if dry_run and limit is not None and processed_count >= limit:
                break

            patient_id = row[join_key]
            meta = meta_by_id.get(patient_id, {})
            out_file = out_dir / f"{patient_id}.md"

            if not dry_run:
                index_entries.append(
                    {
                        "patient_id": patient_id,
                        "file": out_file.name,
                        "dataset": row.get("dataset", ""),
                        "cc": meta.get("cc", ""),
                        "2nd_complaints": meta.get("2nd_complaints", ""),
                        "source_file": src_file.name,
                    }
                )

                if out_file.exists() and not overwrite:
                    continue

                if limit is not None and processed_count >= limit:
                    continue

            raw_payload = (
                f"ID: {patient_id}\n"
                f"METADATA: {json.dumps(meta, ensure_ascii=False)}\n\n"
                f"DIALOGUE:\n{row.get('dialogue', '')}\n\n"
                f"NOTE:\n{row.get('note', '')}"
            )

            request_payload = {
                "model": model,
                "max_tokens": 1500,
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

                client = anthropic.Anthropic()

            print(f"Converting {patient_id} from {src_file.name}...")
            resp = client.messages.create(**request_payload)

            out_file.write_text(resp.content[0].text.strip() + "\n", encoding="utf-8")
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