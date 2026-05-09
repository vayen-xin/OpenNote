from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import io
import json
import os
import re
import time
import zipfile
from pathlib import Path
from typing import Any

import fitz
import requests
import urllib3
from PIL import Image

from alignment_matcher import align_items, build_import_output, build_items

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FILE_DIR = PROJECT_ROOT / "file"
PROMPT_DIR = ROOT / "prompts"
OUTPUT_ROOT = ROOT / "output" / "runs"

DEFAULT_API_KEY = "sk-b459c1b23ae14546a9efdf2ab5f6a031"
DEFAULT_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"


def read_prompt(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def find_default_pdfs() -> tuple[Path, Path]:
    pdfs = sorted(FILE_DIR.glob("*.pdf"), key=lambda p: p.name)
    question = next((p for p in pdfs if "上册" in p.name or "题" in p.name), None)
    answer = next((p for p in pdfs if "下册" in p.name or "答" in p.name), None)
    if question and answer:
        return question, answer
    if len(pdfs) >= 2:
        by_size = sorted(pdfs, key=lambda p: p.stat().st_size)
        return by_size[0], by_size[1]
    raise FileNotFoundError(f"Need two PDF files in {FILE_DIR}")


def parse_args() -> argparse.Namespace:
    default_question, default_answer = find_default_pdfs()
    parser = argparse.ArgumentParser(description="Extract and align a two-book OpenNote question bank.")
    parser.add_argument("--question-pdf", type=Path, default=default_question)
    parser.add_argument("--answer-pdf", type=Path, default=default_answer)
    parser.add_argument("--bank-name", default="导入题库")
    parser.add_argument("--api-key", default=os.getenv("OPENNOTE_AGENT_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or DEFAULT_API_KEY)
    parser.add_argument("--api-url", default=os.getenv("OPENNOTE_AGENT_API_URL", DEFAULT_API_URL))
    parser.add_argument("--vision-model", default=os.getenv("OPENNOTE_AGENT_VISION_MODEL", "qwen-vl-max"))
    parser.add_argument("--max-pages", type=int, default=int(os.getenv("OPENNOTE_AGENT_MAX_PAGES", "0")) or None)
    parser.add_argument("--skip-first", type=int, default=int(os.getenv("OPENNOTE_AGENT_SKIP_FIRST", "10")))
    parser.add_argument("--question-start-page", type=int, default=None)
    parser.add_argument("--question-end-page", type=int, default=None)
    parser.add_argument("--answer-start-page", type=int, default=None)
    parser.add_argument("--answer-end-page", type=int, default=None)
    parser.add_argument("--dpi", type=int, default=int(os.getenv("OPENNOTE_AGENT_DPI", "150")))
    parser.add_argument("--image-max-size", type=int, default=int(os.getenv("OPENNOTE_AGENT_IMAGE_MAX_SIZE", "1024")))
    parser.add_argument("--image-quality", type=int, default=int(os.getenv("OPENNOTE_AGENT_IMAGE_QUALITY", "80")))
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--workers", type=int, default=int(os.getenv("OPENNOTE_AGENT_WORKERS", "4")))
    parser.add_argument("--resume", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--package-zip", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT)
    parser.add_argument("--run-id", default=os.getenv("OPENNOTE_AGENT_RUN_ID") or dt.datetime.now().strftime("%Y%m%d_%H%M%S"))
    return parser.parse_args()


def run_dir_for(output_root: Path, run_id: str) -> Path:
    return output_root / run_id


def ensure_dirs(run_dir: Path) -> dict[str, Path]:
    dirs = {
        "checkpoint": run_dir / "checkpoint",
        "media": run_dir / "media",
        "page_media": run_dir / "media" / "pages",
        "crop_media": run_dir / "media" / "crops",
        "reports": run_dir / "reports",
    }
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return dirs


def render_page(pdf_path: Path, page_index: int, dpi: int) -> Image.Image:
    with fitz.open(pdf_path) as doc:
        page = doc[page_index]
        pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False)
        return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def image_to_png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def compress_for_ai(image: Image.Image, max_size: int, quality: int) -> bytes:
    work = image.copy()
    if max(work.size) > max_size:
        ratio = max_size / max(work.size)
        work = work.resize((int(work.width * ratio), int(work.height * ratio)), Image.LANCZOS)
    buffer = io.BytesIO()
    work.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def normalize_bbox(value: Any, width: int, height: int) -> tuple[int, int, int, int] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        raw = [value.get(k) for k in ("x1", "y1", "x2", "y2")]
    elif isinstance(value, list) and len(value) >= 4:
        raw = value[:4]
    else:
        return None
    try:
        nums = [float(x) for x in raw]
    except (TypeError, ValueError):
        return None
    if all(0 <= n <= 1 for n in nums):
        x1, y1, x2, y2 = nums[0] * width, nums[1] * height, nums[2] * width, nums[3] * height
    else:
        x1, y1, x2, y2 = nums
    x1, x2 = sorted((max(0, int(x1)), min(width, int(x2))))
    y1, y2 = sorted((max(0, int(y1)), min(height, int(y2))))
    if x2 - x1 < 20 or y2 - y1 < 20:
        return None
    return x1, y1, x2, y2


def call_vision(args: argparse.Namespace, prompt: str, image_bytes: bytes, label: str) -> str | None:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": args.vision_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }
        ],
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {args.api_key}", "Content-Type": "application/json"}
    for attempt in range(args.retries):
        try:
            response = requests.post(args.api_url, json=payload, headers=headers, timeout=180, verify=False)
            if response.status_code == 200:
                return response.json()["choices"][0]["message"]["content"]
            print(f"  API error {label}: {response.status_code} {response.text[:160]}")
        except Exception as exc:
            print(f"  network error {label}: {exc}")
        if attempt < args.retries - 1:
            time.sleep(3)
    return None


def parse_json(raw: str | None, error_path: Path) -> list[dict[str, Any]]:
    if not raw:
        return []
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    candidates = [text]
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return [x for x in parsed if isinstance(x, dict)]
        except json.JSONDecodeError:
            pass
    error_path.write_text(raw, encoding="utf-8")
    return []


def page_media_record(mode: str, page_no: int) -> tuple[str, str]:
    media_id = f"{mode}_page_{page_no:03d}"
    return media_id, f"media/pages/{media_id}.png"


def crop_media_record(mode: str, page_no: int, item_no: int) -> tuple[str, str]:
    media_id = f"{mode}_{page_no:03d}_{item_no:02d}"
    return media_id, f"media/crops/{media_id}.png"


def save_image(image: Image.Image, run_dir: Path, relative_path: str) -> None:
    target = run_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(image_to_png_bytes(image))


def load_checkpoint(path: Path) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    if not path.exists():
        return -1, [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    return int(data.get("last_page", -1)), data.get("items", []), data.get("media", [])


def save_checkpoint(path: Path, last_page: int, items: list[dict[str, Any]], media: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps({"last_page": last_page, "items": items, "media": media}, ensure_ascii=False, indent=2), encoding="utf-8")


def append_media(media: list[dict[str, Any]], seen: set[str], media_id: str, path: str, alt: str, source_ref: str) -> None:
    if media_id in seen:
        return
    seen.add(media_id)
    media.append({"id": media_id, "path": path, "mimeType": "image/png", "alt": alt, "sourceRef": source_ref})


def extract_all(
    args: argparse.Namespace,
    pdf_path: Path,
    prompt: str,
    mode: str,
    run_dir: Path,
    dirs: dict[str, Path],
    start_page: int | None = None,
    end_page: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    checkpoint = dirs["checkpoint"] / f"{mode}_checkpoint.json"
    last_page, items, media = load_checkpoint(checkpoint) if args.resume else (-1, [], [])
    seen_media = {str(m.get("id") or "") for m in media}

    with fitz.open(pdf_path) as doc:
        total = len(doc)
    pages = min(total, args.max_pages) if args.max_pages else total
    range_start = max(0, (start_page - 1) if start_page else args.skip_first)
    range_end = min(pages, end_page if end_page else pages)
    start_index = max(range_start, last_page + 1)

    def process_page(page_index: int) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]], int]:
        page_no = page_index + 1
        image = render_page(pdf_path, page_index, args.dpi)
        page_media_id, page_rel = page_media_record(mode, page_no)
        save_image(image, run_dir, page_rel)
        page_media_record_item = {
            "id": page_media_id,
            "path": page_rel,
            "mimeType": "image/png",
            "alt": f"{mode} page {page_no}",
            "sourceRef": f"{pdf_path.name} page {page_no}",
        }

        compressed = compress_for_ai(image, args.image_max_size, args.image_quality)
        raw = call_vision(args, prompt, compressed, f"{mode}-p{page_no}")
        parsed = parse_json(raw, dirs["reports"] / f"parse_error_{mode}_p{page_no}.txt")
        count = 0
        page_items: list[dict[str, Any]] = []
        page_media: list[dict[str, Any]] = [page_media_record_item]

        for offset, item in enumerate(parsed, start=1):
            no = str(item.get("no", "")).strip()
            text = str(item.get("text", "")).strip()
            if not no or not text:
                continue

            bbox = normalize_bbox(item.get("bbox") or item.get("box"), image.width, image.height)
            media_id = page_media_id
            rel_path = page_rel
            image_scope = "page"
            if bbox:
                media_id, rel_path = crop_media_record(mode, page_no, offset)
                crop = image.crop(bbox)
                save_image(crop, run_dir, rel_path)
                page_media.append(
                    {
                        "id": media_id,
                        "path": rel_path,
                        "mimeType": "image/png",
                        "alt": f"{mode} {no}",
                        "sourceRef": f"{pdf_path.name} page {page_no} bbox={bbox}",
                    }
                )
                image_scope = "crop"

            markdown = f"![{mode}原图]({media_id})\n\n{text}"
            record = {
                "no": no,
                mode: markdown,
                "mediaId": media_id,
                "pageMediaId": page_media_id,
                "page": page_no,
                "imageScope": image_scope,
                "bbox": list(bbox) if bbox else None,
            }
            for key in ("type", "sectionTitle", "answerPageHint", "answerLetter"):
                if item.get(key) is not None:
                    record[key] = str(item.get(key, "")).strip()
            page_items.append(record)
            count += 1

        return page_index, page_items, page_media, count

    print(f"\nextract {mode}: {pdf_path.name} pages {start_index + 1}-{range_end}/{total}, workers={args.workers}")
    if start_index >= range_end:
        return items, media

    pending: dict[int, tuple[list[dict[str, Any]], list[dict[str, Any]], int]] = {}
    next_commit = start_index
    page_indexes = list(range(start_index, range_end))

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_map = {executor.submit(process_page, page_index): page_index for page_index in page_indexes}
        for future in concurrent.futures.as_completed(future_map):
            page_index = future_map[future]
            try:
                done_page, page_items, page_media, page_count = future.result()
            except Exception as exc:
                done_page = page_index
                page_items = []
                page_media = []
                page_count = 0
                print(f"  page {done_page + 1:03d}: failed with exception: {exc}")
            pending[done_page] = (page_items, page_media, page_count)

            while next_commit in pending:
                commit_items, commit_media, commit_count = pending.pop(next_commit)
                for media_item in commit_media:
                    append_media(
                        media,
                        seen_media,
                        str(media_item.get("id") or ""),
                        str(media_item.get("path") or ""),
                        str(media_item.get("alt") or ""),
                        str(media_item.get("sourceRef") or ""),
                    )
                items.extend(commit_items)
                save_checkpoint(checkpoint, next_commit, items, media)
                print(f"  page {next_commit + 1:03d}: {commit_count} items, total={len(items)}")
                next_commit += 1

    return items, media


def save_preview(run_dir: Path, output: dict[str, Any], report: dict[str, Any]) -> None:
    path = run_dir / "reports" / "extraction_preview.md"
    lines = [
        "# OpenNote extraction preview\n\n",
        f"- questions: {report['summary']['questions']}\n",
        f"- answers: {report['summary']['answers']}\n",
        f"- extra answers: {report['summary']['extraAnswers']}\n",
        f"- status: {report['summary']['statusCounts']}\n\n",
        "| # | status | stem | answer |\n",
        "|---|--------|------|--------|\n",
    ]
    review_by_sort = {item["sortNo"]: item for item in report.get("reviewItems", [])}
    questions = output["chapters"][0]["questions"]
    for question in questions[:120]:
        sort_no = question["sortNo"]
        status = review_by_sort.get(sort_no, {}).get("status", "confirmed")
        stem_text = " ".join(block.get("text", "[image]") for block in question["stem"])[:120]
        answer_text = " ".join(block.get("text", "[image]") for block in question["answer"])[:120]
        lines.append(f"| {sort_no} | {status} | {stem_text} | {answer_text} |\n")
    path.write_text("".join(lines), encoding="utf-8")


def package_zip(run_dir: Path, output_json: Path) -> Path:
    zip_path = run_dir / "opennote-import.v1.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(output_json, "opennote-import.v1.json")
        media_root = run_dir / "media"
        if media_root.exists():
            for file in media_root.rglob("*"):
                if file.is_file():
                    archive.write(file, file.relative_to(run_dir).as_posix())
    return zip_path


def main() -> None:
    args = parse_args()
    run_dir = run_dir_for(args.output_root, args.run_id)
    dirs = ensure_dirs(run_dir)
    (run_dir / "run_meta.json").write_text(
        json.dumps(
            {
                "runId": args.run_id,
                "questionPdf": str(args.question_pdf),
                "answerPdf": str(args.answer_pdf),
                "visionModel": args.vision_model,
                "startedAt": dt.datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    question_prompt = read_prompt("question.txt")
    answer_prompt = read_prompt("answer.txt")
    questions, q_media = extract_all(
        args,
        args.question_pdf,
        question_prompt,
        "question",
        run_dir,
        dirs,
        start_page=args.question_start_page,
        end_page=args.question_end_page,
    )
    answers, a_media = extract_all(
        args,
        args.answer_pdf,
        answer_prompt,
        "answer",
        run_dir,
        dirs,
        start_page=args.answer_start_page,
        end_page=args.answer_end_page,
    )

    q_items = build_items(questions, "question")
    a_items = build_items(answers, "answer")
    matches, extra_answers = align_items(q_items, a_items)
    media = q_media + a_media
    output, report = build_import_output(questions, answers, matches, extra_answers, media=media, bank_name=args.bank_name)

    output_json = run_dir / "opennote-import.v1.json"
    report_json = dirs["reports"] / "match_report.json"
    output_json.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    save_preview(run_dir, output, report)
    zip_path = package_zip(run_dir, output_json) if args.package_zip else None

    summary = report["summary"]
    print("\ncompleted")
    print(f"run: {run_dir}")
    print(f"questions: {summary['questions']}, answers: {summary['answers']}, extra: {summary['extraAnswers']}")
    print(f"status: {summary['statusCounts']}")
    print(f"json: {output_json}")
    if zip_path:
        print(f"zip: {zip_path}")
    print(f"report: {report_json}")


if __name__ == "__main__":
    main()
