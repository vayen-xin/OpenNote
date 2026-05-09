# OpenNote PDF Import Agent

输入：题目 PDF + 答案 PDF。
输出：OpenNote 可导入的 `opennote.import.v1` JSON 和 zip 包。

## 当前流程

```text
PDF -> 逐页转图 -> 视觉模型提取结构化题目/答案
-> 保存页图/题图 + checkpoint
-> 全局序列对齐
-> opennote-import.v1.json + opennote-import.v1.zip + match_report.json
```

## 目录约定

输入 PDF 默认读取：

```text
../file/26判断推理上册.pdf
../file/26判断推理下册.pdf
```

每次运行输出到：

```text
agent/output/runs/<run_id>/
  checkpoint/
    question_checkpoint.json
    answer_checkpoint.json
  media/
    pages/
    crops/
  reports/
    extraction_preview.md
    match_report.json
  opennote-import.v1.json
  opennote-import.v1.zip
  run_meta.json
```

## 运行

```bash
python agent/run.py
```

小范围测试：

```bash
python agent/run.py --run-id smoke --max-pages 12 --skip-first 10 --no-resume
```

重新只做匹配，不重新调用视觉模型：

```bash
python agent/rematch.py
```

低置信项 AI 复核：

```bash
python agent/rematch_ai.py --limit 50
```

## API 配置

`run.py` 保留了原来的 DashScope 默认 API 配置，同时支持环境变量覆盖：

```bash
set OPENNOTE_AGENT_API_KEY=your_key
set OPENNOTE_AGENT_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
set OPENNOTE_AGENT_VISION_MODEL=qwen-vl-max
```

## 图片记录

现在每页都会保存页图：

```text
media/pages/question_page_011.png
media/pages/answer_page_011.png
```

如果视觉模型返回 `bbox`，会额外保存单题/单解析裁剪图：

```text
media/crops/question_011_01.png
media/crops/answer_011_01.png
```

每条 checkpoint 会记录：

```json
{
  "mediaId": "question_011_01",
  "pageMediaId": "question_page_011",
  "imageScope": "crop",
  "bbox": [x1, y1, x2, y2]
}
```

如果没有 `bbox`，则退回引用整页图，避免图片信息丢失。

## 匹配策略

`alignment_matcher.py` 不再让 AI 在大窗口里全局搜索，而是使用：

- 题号相似
- 解析页提示
- 题型一致
- 章节/小节一致
- 文本重叠
- 答案字母存在
- 全局序列对齐，允许跳过漏识别题目和多识别答案

输出状态：

- `confirmed`: 高置信自动匹配
- `needs_review`: 建议人工复核
- `missing_answer`: 题目未匹配到答案
- `extra_answer`: 答案未分配给题目

`rematch_ai.py` 只会复核低置信项附近的小候选集，生成 `reports/ai_review.json`，不会直接覆盖导入结果。

