from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests

from alignment_matcher import build_items, load_checkpoint, strip_media


ROOT = Path(__file__).resolve().parent


def latest_run_dir() -> Path | None:
    runs = ROOT / "output" / "runs"
    if not runs.exists():
        return None
    candidates = [p for p in runs.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_args() -> argparse.Namespace:
    run_dir = latest_run_dir()
    default_question = run_dir / "checkpoint" / "question_checkpoint.json" if run_dir else ROOT / "output" / ".checkpoint" / "question_checkpoint.json"
    default_answer = run_dir / "checkpoint" / "answer_checkpoint.json" if run_dir else ROOT / "output" / ".checkpoint" / "answer_checkpoint.json"
    default_report = run_dir / "reports" / "match_report.json" if run_dir else ROOT / "match_report.json"
    default_output = run_dir / "reports" / "ai_review.json" if run_dir else ROOT / "ai_review.json"

    parser = argparse.ArgumentParser(description="Ask an LLM to review only low-confidence match candidates.")
    parser.add_argument("--question-file", type=Path, default=default_question)
    parser.add_argument("--answer-file", type=Path, default=default_answer)
    parser.add_argument("--report", type=Path, default=default_report)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument("--window", type=int, default=3)
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--api-url", default=os.getenv("OPENNOTE_AGENT_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"))
    parser.add_argument("--api-key", default=os.getenv("OPENNOTE_AGENT_API_KEY") or os.getenv("DASHSCOPE_API_KEY", ""))
    parser.add_argument("--model", default=os.getenv("OPENNOTE_AGENT_MATCH_MODEL", "qwen-max"))
    return parser.parse_args()


def ask_model(args: argparse.Namespace, prompt: str) -> dict[str, Any]:
    if not args.api_key:
        raise RuntimeError("Missing API key. Set OPENNOTE_AGENT_API_KEY or DASHSCOPE_API_KEY.")
    payload = {
        "model": args.model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {args.api_key}", "Content-Type": "application/json"}
    response = requests.post(args.api_url, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    raw = response.json()["choices"][0]["message"]["content"].strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("\n", 1)[0]
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        raw = raw[start : end + 1]
    return json.loads(raw)


def candidate_answers(answer_count: int, answer_index: int | None, question_index: int, window: int) -> list[int]:
    center = answer_index if answer_index is not None else min(question_index, answer_count - 1)
    start = max(0, center - window)
    end = min(answer_count, center + window + 1)
    return list(range(start, end))


def build_prompt(question: Any, answers: list[Any], candidate_indices: list[int]) -> str:
    lines = [
        "你只需要在给定候选答案中选择最匹配的一项，不要跨候选集寻找。",
        "如果没有合适答案，返回 answerIndex=null。",
        '输出 JSON: {"answerIndex": 12, "confidence": 0.0-1.0, "reason": "简短原因"}',
        "",
        f"题目 qi={question.index}, no={question.no_raw}, page={question.page}:",
        strip_media(question.full_text, question.media_id)[:900],
        "",
        "候选答案:",
    ]
    for idx in candidate_indices:
        answer = answers[idx]
        lines.append(f"ai={idx}, no={answer.no_raw}, page={answer.page}: {strip_media(answer.full_text, answer.media_id)[:700]}")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    question_raw = load_checkpoint(args.question_file)
    answer_raw = load_checkpoint(args.answer_file)
    questions = build_items(question_raw, "question")
    answers = build_items(answer_raw, "answer")
    report = json.loads(args.report.read_text(encoding="utf-8"))

    review_items = report.get("reviewItems", [])[: args.limit]
    results: list[dict[str, Any]] = []
    for item in review_items:
        qi = int(item["questionIndex"])
        candidates = candidate_answers(len(answers), item.get("answerIndex"), qi, args.window)
        prompt = build_prompt(questions[qi], answers, candidates)
        try:
            decision = ask_model(args, prompt)
        except Exception as exc:
            decision = {"answerIndex": None, "confidence": 0, "reason": f"AI review failed: {exc}"}
        results.append({"questionIndex": qi, "candidates": candidates, "decision": decision, "previous": item})
        print(f"reviewed qi={qi}, decision={decision.get('answerIndex')}, confidence={decision.get('confidence')}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"reviews": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"output: {args.output}")


if __name__ == "__main__":
    main()
