from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


MEDIA_RE = re.compile(r"!\[[^\]]*]\([^)]+\)")


@dataclass(frozen=True)
class SourceItem:
    index: int
    raw: dict[str, Any]
    kind: str
    no_raw: str
    no: int | None
    page: int | None
    media_id: str
    text: str
    full_text: str
    category: str
    section_title: str
    answer_letter: str
    hint_pages: tuple[int, int] | None


@dataclass(frozen=True)
class MatchResult:
    question_index: int
    answer_index: int | None
    score: float
    status: str
    reasons: tuple[str, ...]


def strip_media(text: str, media_id: str = "") -> str:
    text = MEDIA_RE.sub("", text)
    if media_id:
        text = text.replace(f"![question原图]({media_id})", "")
        text = text.replace(f"![answer原图]({media_id})", "")
    return re.sub(r"\s+", " ", text).strip()


def first_text(item: dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        if key in item and item[key] is not None:
            return str(item[key])
    return ""


def text_to_blocks(text: str, default_alt: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    last = 0
    for match in MEDIA_RE.finditer(text):
        before = text[last : match.start()].strip()
        if before:
            blocks.append({"type": "text", "text": before})
        media_id_match = re.search(r"\(([^)]+)\)", match.group(0))
        alt_match = re.search(r"!\[([^\]]*)]", match.group(0))
        if media_id_match:
            blocks.append(
                {
                    "type": "image",
                    "mediaId": media_id_match.group(1),
                    "alt": alt_match.group(1) if alt_match and alt_match.group(1) else default_alt,
                }
            )
        last = match.end()
    tail = text[last:].strip()
    if tail:
        blocks.append({"type": "text", "text": tail})
    if not blocks and text.strip():
        blocks.append({"type": "text", "text": text.strip()})
    return blocks


def normalize_media(media: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in media or []:
        media_id = str(item.get("id") or item.get("mediaId") or "").strip()
        path = str(item.get("path") or "").strip()
        if not media_id or not path or media_id in seen:
            continue
        seen.add(media_id)
        normalized.append(
            {
                "id": media_id,
                "path": path,
                "mimeType": item.get("mimeType") or "image/png",
                "alt": item.get("alt") or media_id,
                "sourceRef": item.get("sourceRef") or "",
            }
        )
    return normalized


def collect_media_ids(chapters: list[dict[str, Any]]) -> set[str]:
    media_ids: set[str] = set()
    for chapter in chapters:
        for question in chapter.get("questions", []):
            for key in ("stem", "answer", "explanation"):
                for block in question.get(key, []):
                    if isinstance(block, dict) and block.get("type") == "image" and block.get("mediaId"):
                        media_ids.add(str(block["mediaId"]))
    return media_ids


def parse_no(value: Any, text: str = "") -> int | None:
    raw = str(value or "").strip()
    match = re.search(r"\d{1,4}", raw)
    if match:
        return int(match.group())
    match = re.search(r"^\s*(\d{1,4})\s*[.。．、]", text)
    if match:
        return int(match.group(1))
    return None


def parse_answer_letter(text: str) -> str:
    match = re.search(r"(?:答案\s*[】\]]?\s*[:：]?\s*)?([A-D])\s*[.。．、]", text)
    return match.group(1) if match else ""


def parse_hint_pages(text: str) -> tuple[int, int] | None:
    patterns = [
        r"解析见下册第\s*(\d{1,4})\s*[-—~至一]\s*(\d{1,4})\s*页",
        r"解析见下册第\s*(\d{1,4})\s*页",
        r"下册第\s*(\d{1,4})\s*[-—~至一]\s*(\d{1,4})\s*页",
        r"下册第\s*(\d{1,4})\s*页",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        start = int(match.group(1))
        end = int(match.group(2)) if len(match.groups()) >= 2 and match.group(2) else start
        return (min(start, end), max(start, end))
    return None


def parse_hint_value(value: Any) -> tuple[int, int] | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.search(r"(\d{1,4})(?:\s*[-—~至一]\s*(\d{1,4}))?", raw)
    if not match:
        return None
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else start
    return (min(start, end), max(start, end))


def normalize_text(text: str) -> str:
    chars: list[str] = []
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff" or ch.isalnum():
            chars.append(ch.lower())
    return "".join(chars)


def char_ngram_similarity(a: str, b: str, n: int = 2, limit: int = 360) -> float:
    a = normalize_text(a)[:limit]
    b = normalize_text(b)[:limit]
    if len(a) < n or len(b) < n:
        return 0.0
    ag = {a[i : i + n] for i in range(len(a) - n + 1)}
    bg = {b[i : i + n] for i in range(len(b) - n + 1)}
    if not ag or not bg:
        return 0.0
    return len(ag & bg) / len(ag | bg)


def classify(text: str) -> str:
    if any(word in text for word in ["图形", "规律性", "问号处", "九宫格", "黑白", "对称", "平移", "旋转"]):
        return "figure"
    if any(word in text for word in ["定义", "属于", "符合", "不符合", "关键词"]):
        return "definition"
    if any(word in text for word in ["之于", "类比", "相当于", "关系"]):
        return "analogy"
    if any(word in text for word in ["削弱", "加强", "支持", "质疑", "前提", "推出", "论点", "论据"]):
        return "logic"
    return "unknown"


def normalized_category(raw_value: Any, text: str) -> str:
    raw = str(raw_value or "").strip().lower()
    allowed = {"figure", "definition", "analogy", "logic", "other"}
    if raw in allowed:
        return raw if raw != "other" else "unknown"
    return classify(text)


def build_items(raw_items: list[dict[str, Any]], kind: str) -> list[SourceItem]:
    text_keys = ["question", "stem"] if kind == "question" else ["answer", "explanation"]
    items: list[SourceItem] = []
    for idx, raw in enumerate(raw_items):
        media_id = str(raw.get("mediaId", "") or "")
        full = first_text(raw, text_keys)
        plain = strip_media(full, media_id)
        no_raw = str(raw.get("no", "") or "")
        page_value = raw.get("page")
        try:
            page = int(page_value) if page_value is not None else None
        except (TypeError, ValueError):
            page = None
        items.append(
            SourceItem(
                index=idx,
                raw=raw,
                kind=kind,
                no_raw=no_raw,
                no=parse_no(no_raw, plain),
                page=page,
                media_id=media_id,
                text=plain,
                full_text=full,
                category=normalized_category(raw.get("type"), plain),
                section_title=str(raw.get("sectionTitle", "") or "").strip(),
                answer_letter=str(raw.get("answerLetter", "") or "").strip()[:1] if kind == "answer" and raw.get("answerLetter") else parse_answer_letter(plain) if kind == "answer" else "",
                hint_pages=parse_hint_value(raw.get("answerPageHint")) or parse_hint_pages(plain),
            )
        )
    return items


def pair_score(question: SourceItem, answer: SourceItem) -> tuple[float, tuple[str, ...]]:
    score = 0.0
    reasons: list[str] = []

    if question.no is not None and answer.no is not None:
        if question.no == answer.no:
            score += 0.22
            reasons.append("same_no")
        else:
            diff = abs(question.no - answer.no)
            if diff <= 2:
                score += max(0.03, 0.08 - diff * 0.025)
                reasons.append("near_no")
            elif diff <= 10:
                score += 0.035
                reasons.append("loose_near_no")

    if question.hint_pages and answer.page is not None:
        start, end = question.hint_pages
        if start <= answer.page <= end:
            score += 0.32
            reasons.append("page_hint")
        elif start - 2 <= answer.page <= end + 2:
            score += 0.16
            reasons.append("near_page_hint")

    if question.category != "unknown" and question.category == answer.category:
        score += 0.12
        reasons.append("same_category")

    if question.section_title and answer.section_title and question.section_title == answer.section_title:
        score += 0.10
        reasons.append("same_section")

    sim = char_ngram_similarity(question.text, answer.text)
    if sim >= 0.16:
        score += min(0.20, sim)
        reasons.append("text_overlap")
    elif sim >= 0.06:
        score += 0.06
        reasons.append("weak_text_overlap")

    if answer.answer_letter:
        score += 0.04
        reasons.append("has_answer")

    index_gap = abs(question.index - answer.index)
    if index_gap <= 3:
        score += max(0.03, 0.10 - index_gap * 0.02)
        reasons.append("near_sequence")

    return min(score, 1.0), tuple(reasons)


def confidence_status(score: float) -> str:
    if score >= 0.72:
        return "confirmed"
    if score >= 0.38:
        return "needs_review"
    return "weak"


def align_items(
    questions: list[SourceItem],
    answers: list[SourceItem],
    skip_question_cost: float = 0.56,
    skip_answer_cost: float = 0.50,
    min_match_score: float = 0.16,
) -> tuple[list[MatchResult], list[int]]:
    qn = len(questions)
    an = len(answers)
    dp = [[0.0] * (an + 1) for _ in range(qn + 1)]
    move = [[""] * (an + 1) for _ in range(qn + 1)]

    for i in range(1, qn + 1):
        dp[i][0] = dp[i - 1][0] + skip_question_cost
        move[i][0] = "skip_q"
    for j in range(1, an + 1):
        dp[0][j] = dp[0][j - 1] + skip_answer_cost
        move[0][j] = "skip_a"

    score_cache: dict[tuple[int, int], tuple[float, tuple[str, ...]]] = {}
    for i in range(1, qn + 1):
        q = questions[i - 1]
        for j in range(1, an + 1):
            a = answers[j - 1]
            score, reasons = pair_score(q, a)
            score_cache[(i - 1, j - 1)] = (score, reasons)
            match_cost = 1.0 - score if score >= min_match_score else math.inf

            choices = [
                (dp[i - 1][j - 1] + match_cost, "match"),
                (dp[i - 1][j] + skip_question_cost, "skip_q"),
                (dp[i][j - 1] + skip_answer_cost, "skip_a"),
            ]
            best_cost, best_move = min(choices, key=lambda x: x[0])
            dp[i][j] = best_cost
            move[i][j] = best_move

    matched: list[MatchResult] = []
    extra_answers: list[int] = []
    i, j = qn, an
    while i > 0 or j > 0:
        action = move[i][j]
        if action == "match":
            score, reasons = score_cache[(i - 1, j - 1)]
            matched.append(MatchResult(i - 1, j - 1, score, confidence_status(score), reasons))
            i -= 1
            j -= 1
        elif action == "skip_q":
            matched.append(MatchResult(i - 1, None, 0.0, "missing_answer", ()))
            i -= 1
        else:
            extra_answers.append(j - 1)
            j -= 1

    matched.reverse()
    extra_answers.reverse()
    return matched, extra_answers


def load_checkpoint(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    if isinstance(data, list):
        return data
    raise ValueError(f"Unsupported checkpoint shape: {path}")


def build_import_output(
    question_items: list[dict[str, Any]],
    answer_items: list[dict[str, Any]],
    matches: list[MatchResult],
    extra_answers: list[int],
    media: list[dict[str, Any]] | None = None,
    bank_name: str = "导入题库",
) -> tuple[dict[str, Any], dict[str, Any]]:
    questions_out: list[dict[str, Any]] = []
    status_counts: dict[str, int] = {}
    review_items: list[dict[str, Any]] = []

    for order, result in enumerate(matches, start=1):
        q_raw = question_items[result.question_index]
        a_raw = answer_items[result.answer_index] if result.answer_index is not None else None
        explanation = first_text(a_raw or {}, ["answer", "explanation"]) if a_raw else ""
        status_counts[result.status] = status_counts.get(result.status, 0) + 1
        if result.status != "confirmed":
            review_items.append(
                {
                    "sortNo": order,
                    "questionIndex": result.question_index,
                    "answerIndex": result.answer_index,
                    "score": round(result.score, 4),
                    "status": result.status,
                    "reasons": list(result.reasons),
                }
            )
        questions_out.append(
            {
                "sortNo": order,
                "externalId": f"q-{order:04d}",
                "sourceRef": f"question_index={result.question_index}, answer_index={result.answer_index}",
                "kind": "manual",
                "stem": text_to_blocks(first_text(q_raw, ["question", "stem"]), "question image"),
                "answer": text_to_blocks(explanation, "answer image"),
                "explanation": [],
                "tags": [result.status],
            }
        )

    report = {
        "summary": {
            "questions": len(question_items),
            "answers": len(answer_items),
            "matchedQuestions": len(matches),
            "extraAnswers": len(extra_answers),
            "statusCounts": status_counts,
        },
        "reviewItems": review_items,
        "extraAnswers": extra_answers,
    }

    chapters = [{"title": "鍏ㄩ儴棰樼洰", "sortNo": 1, "questions": questions_out}]
    used_media_ids = collect_media_ids(chapters)
    output = {
        "format": "opennote.import.v1",
        "bank": {"name": bank_name, "description": "PDF 自动解析并经序列对齐生成"},
        "chapters": [{"title": "全部题目", "sortNo": 1, "questions": questions_out}],
        "media": [item for item in normalize_media(media) if item["id"] in used_media_ids],
        "extractionReport": {
            "warnings": [
                f"{len(review_items)} questions need review",
                f"{len(extra_answers)} extra answers were not assigned",
            ],
            "matchSummary": report["summary"],
        },
    }
    return output, report
