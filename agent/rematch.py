from __future__ import annotations

import argparse
import json
from pathlib import Path

from alignment_matcher import align_items, build_import_output, build_items, load_checkpoint


ROOT = Path(__file__).resolve().parent


def latest_run_dir() -> Path | None:
    runs = ROOT / "output" / "runs"
    if not runs.exists():
        return None
    candidates = [p for p in runs.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def load_media(base_output: Path | None) -> list[dict]:
    if not base_output or not base_output.exists():
        return []
    data = json.loads(base_output.read_text(encoding="utf-8"))
    media = data.get("media", [])
    return media if isinstance(media, list) else []


def parse_args() -> argparse.Namespace:
    run_dir = latest_run_dir()
    default_base = run_dir / "opennote-import.v1.json" if run_dir else None
    default_question = run_dir / "checkpoint" / "question_checkpoint.json" if run_dir else ROOT / "output" / ".checkpoint" / "question_checkpoint.json"
    default_answer = run_dir / "checkpoint" / "answer_checkpoint.json" if run_dir else ROOT / "output" / ".checkpoint" / "answer_checkpoint.json"
    default_out = run_dir / "opennote-import-aligned.json" if run_dir else ROOT / "opennote-import-aligned.json"
    default_report = run_dir / "reports" / "match_report.json" if run_dir else ROOT / "match_report.json"

    parser = argparse.ArgumentParser(description="Rematch extracted OpenNote questions and answers with sequence alignment.")
    parser.add_argument("--question-file", type=Path, default=default_question)
    parser.add_argument("--answer-file", type=Path, default=default_answer)
    parser.add_argument("--base-output", type=Path, default=default_base)
    parser.add_argument("--output", type=Path, default=default_out)
    parser.add_argument("--report", type=Path, default=default_report)
    parser.add_argument("--bank-name", default="导入题库")
    parser.add_argument("--min-match-score", type=float, default=0.16)
    parser.add_argument("--skip-question-cost", type=float, default=0.56)
    parser.add_argument("--skip-answer-cost", type=float, default=0.50)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.question_file.exists():
        raise FileNotFoundError(f"Question checkpoint not found: {args.question_file}")
    if not args.answer_file.exists():
        raise FileNotFoundError(f"Answer checkpoint not found: {args.answer_file}")

    question_raw = load_checkpoint(args.question_file)
    answer_raw = load_checkpoint(args.answer_file)
    questions = build_items(question_raw, "question")
    answers = build_items(answer_raw, "answer")

    matches, extra_answers = align_items(
        questions,
        answers,
        skip_question_cost=args.skip_question_cost,
        skip_answer_cost=args.skip_answer_cost,
        min_match_score=args.min_match_score,
    )
    output, report = build_import_output(
        question_raw,
        answer_raw,
        matches,
        extra_answers,
        media=load_media(args.base_output),
        bank_name=args.bank_name,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = report["summary"]
    print(f"questions: {summary['questions']}")
    print(f"answers: {summary['answers']}")
    print(f"extra answers: {summary['extraAnswers']}")
    print(f"status: {summary['statusCounts']}")
    print(f"output: {args.output}")
    print(f"report: {args.report}")


if __name__ == "__main__":
    main()
