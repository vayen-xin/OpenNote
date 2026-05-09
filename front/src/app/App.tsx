import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, Eye, FileUp, History, Lock, Menu, Pen, Settings, Wrench, X } from "lucide-react";
import { createImportTask, getBanks, getChapters, getDoodle, getImportTasks, getProgress, getQuestionDetail, getQuestionIndexByBank, saveDoodle, submitAttempt } from "./api";
import type { CSSProperties } from "react";
import type { ChapterSummary, DoodlePoint, DoodleStroke, ImportTaskSummary, ProgressSummary, QuestionBank, QuestionDetail, QuestionListItem, QuestionStatus } from "./types";

const COLORS = ["#ff3b30", "#34c759", "#007aff", "#ffcc00", "#af52de", "#00c7be", "#111827", "#ffffff"];

function chipClass(status: QuestionStatus, current: boolean) {
  if (current) return "border-blue-300 bg-blue-200 text-blue-700";
  if (status === "correct") return "border-[#CBFCC0] bg-[#CBFCC0] text-green-800";
  if (status === "wrong") return "border-[#F9B2C0] bg-[#F9B2C0] text-rose-800";
  if (status === "pending_review") return "border-amber-300 bg-amber-100 text-amber-800";
  return "border-gray-200 bg-gray-50 text-gray-600";
}

const buildOrderedIds = (chapterList: ChapterSummary[], questionList: Array<{ id: number; chapterId: number; sortNo: number }>) =>
  [...chapterList]
    .sort((a, b) => a.sortNo - b.sortNo)
    .flatMap((ch) =>
      questionList
        .filter((q) => q.chapterId === ch.id)
        .sort((a, b) => a.sortNo - b.sortNo)
        .map((q) => q.id),
    );

function RichContent({ text, fontScale }: { text: string; fontScale: number }) {
  const parts: JSX.Element[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      parts.push(
        <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
          {before}
        </span>,
      );
    }
    parts.push(
      <img
        key={`img-${match.index}`}
        src={match[2]}
        alt={match[1]}
        draggable={false}
        className="my-3 max-h-80 max-w-full rounded border object-contain"
      />,
    );
    lastIndex = pattern.lastIndex;
  }
  const tail = text.slice(lastIndex);
  if (tail) {
    parts.push(
      <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
        {tail}
      </span>,
    );
  }
  return (
    <div className="leading-8" style={{ fontSize: `${fontScale}em` }}>
      {parts.length > 0 ? parts : text}
    </div>
  );
}

export default function App() {
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [bankId, setBankId] = useState(1);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [questionIndex, setQuestionIndex] = useState<QuestionListItem[]>([]);
  const [questionCache, setQuestionCache] = useState<Record<number, QuestionDetail>>({});
  const [qid, setQid] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [questionLoading, setQuestionLoading] = useState(false);

  const [showAnswer, setShowAnswer] = useState(false);
  const [lockAnswer, setLockAnswer] = useState(false);
  const [noteVisible, setNoteVisible] = useState(true);
  const [penEnabled, setPenEnabled] = useState(true);
  const [toolOpen, setToolOpen] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#ff3b30");
  const [width, setWidth] = useState(3);

  const [autoNextOnMark, setAutoNextOnMark] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [bootError, setBootError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [importMode, setImportMode] = useState<"single" | "double">("double");
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerModelName, setProviderModelName] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [singleMaterialName, setSingleMaterialName] = useState("");
  const [doubleMaterialName, setDoubleMaterialName] = useState("");
  const [singleQuestionFile, setSingleQuestionFile] = useState<File | null>(null);
  const [singleSplitPage, setSingleSplitPage] = useState("");
  const [doubleQuestionFile, setDoubleQuestionFile] = useState<File | null>(null);
  const [doubleAnswerFile, setDoubleAnswerFile] = useState<File | null>(null);
  const [parseTasks, setParseTasks] = useState<ImportTaskSummary[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<DoodleStroke[]>([]);
  const seqRef = useRef(1);
  const undoRef = useRef<DoodleStroke[][]>([]);
  const holdTimerRef = useRef<number | null>(null);
  const drawRef = useRef<{ active: boolean; points: DoodlePoint[] }>({ active: false, points: [] });
  const dirtyRef = useRef(false);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const loadingQuestionIdsRef = useRef<Set<number>>(new Set());

  const question = useMemo(() => questionCache[qid] ?? null, [questionCache, qid]);
  const currentQuestionMeta = useMemo(() => questionIndex.find((q) => q.id === qid) ?? null, [questionIndex, qid]);
  const orderedIds = useMemo(() => buildOrderedIds(chapters, questionIndex), [chapters, questionIndex]);
  const idx = orderedIds.findIndex((id) => id === qid);

  const refresh = async (targetBankId: number, preferredQid?: number) => {
    const [c, q, p] = await Promise.all([getChapters(targetBankId), getQuestionIndexByBank(targetBankId), getProgress(targetBankId)]);
    setChapters(c);
    setQuestionIndex(q);
    setQuestionCache({});
    setProgress(p);
    if (c.length > 0) setExpanded(new Set([c[0].id]));
    const ids = buildOrderedIds(c, q);
    if (ids.length === 0) {
      setQid(0);
      return;
    }
    if (preferredQid && ids.includes(preferredQid)) {
      setQid(preferredQid);
      return;
    }
    if (qid && ids.includes(qid)) {
      setQid(qid);
      return;
    }
    setQid(ids[0]);
  };

  const ensureQuestionLoaded = async (questionId: number) => {
    if (!questionId) return;
    if (questionCache[questionId] || loadingQuestionIdsRef.current.has(questionId)) return;
    loadingQuestionIdsRef.current.add(questionId);
    if (questionId === qid) {
      setQuestionLoading(true);
    }
    try {
      const detail = await getQuestionDetail(questionId);
      setQuestionCache((prev) => ({ ...prev, [questionId]: detail }));
    } finally {
      loadingQuestionIdsRef.current.delete(questionId);
      if (questionId === qid) {
        setQuestionLoading(false);
      }
    }
  };

  const prefetchNeighborQuestions = (centerQuestionId: number) => {
    const centerIndex = orderedIds.findIndex((id) => id === centerQuestionId);
    if (centerIndex < 0) return;
    const neighborIds = [orderedIds[centerIndex - 1], orderedIds[centerIndex + 1]].filter(
      (id): id is number => typeof id === "number" && id > 0,
    );
    neighborIds.forEach((id) => {
      ensureQuestionLoaded(id).catch(() => undefined);
    });
  };

  const refreshImportTasks = async () => {
    const tasks = await getImportTasks();
    setParseTasks(tasks);
    const latestImportedBankId = tasks.find((task) => task.status === "done" && task.importedBankId)?.importedBankId;
    if (latestImportedBankId && !banks.some((bank) => bank.id === latestImportedBankId)) {
      const list = await getBanks();
      setBanks(list);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await getBanks();
        setBanks(list);
        const first = list[0]?.id ?? 1;
        setBankId(first);
        await Promise.all([refresh(first), refreshImportTasks()]);
        setBootError("");
      } catch (error) {
        console.error(error);
        setBootError("初始化加载失败，请检查后端接口与网络连接。");
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshImportTasks().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [banks]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokesRef.current) {
      if (s.points.length === 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.tool === "eraser" ? s.width * 3 : s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0].nx * canvas.width, s.points[0].ny * canvas.height);
      for (let i = 1; i < s.points.length; i += 1) {
        ctx.lineTo(s.points[i].nx * canvas.width, s.points[i].ny * canvas.height);
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    redraw();
  };

  const loadDoodleFor = async (questionId: number) => {
    resizeCanvas();
    const data = await getDoodle(questionId, "full_canvas");
    strokesRef.current = data?.strokes ?? [];
    seqRef.current = (strokesRef.current.at(-1)?.seqNo ?? 0) + 1;
    undoRef.current = [];
    redraw();
  };

  const saveDoodleFor = async (questionId: number) => {
    if (!dirtyRef.current) return;
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    const task = (async () => {
      await saveDoodle(questionId, "full_canvas", {
        questionId,
        layer: "full_canvas",
        layoutVersion: 1,
        fontScale: 1,
        baseWidth: canvas.width,
        baseHeight: canvas.height,
        strokes: strokesRef.current,
      });
      dirtyRef.current = false;
    })();
    saveInFlightRef.current = task;
    try {
      await task;
    } finally {
      saveInFlightRef.current = null;
      setSaving(false);
    }
  };

  useEffect(() => {
    resizeCanvas();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(wrap);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  useEffect(() => {
    if (!qid) return;
    ensureQuestionLoaded(qid).catch(() => undefined);
    prefetchNeighborQuestions(qid);
  }, [qid, orderedIds]);

  useEffect(() => {
    if (!qid) return;
    loadDoodleFor(qid);
  }, [qid]);

  useEffect(() => {
    if (!qid) return;
    const timer = window.setInterval(() => {
      saveDoodleFor(qid).catch(() => undefined);
    }, 10000);
    const onBeforeUnload = () => {
      saveDoodleFor(qid).catch(() => undefined);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [qid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { nx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), ny: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), t: Date.now() };
    };
    const canDraw = () => noteVisible && penEnabled;
    const down = (e: PointerEvent) => {
      if (!canDraw()) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawRef.current = { active: true, points: [p(e)] };
      undoRef.current.push([...strokesRef.current]);
    };
    const move = (e: PointerEvent) => {
      if (!drawRef.current.active || !canDraw()) return;
      e.preventDefault();
      drawRef.current.points.push(p(e));
      const draft: DoodleStroke = { seqNo: seqRef.current, tool, color, width, points: drawRef.current.points };
      const keep = strokesRef.current;
      strokesRef.current = [...keep, draft];
      redraw();
      strokesRef.current = keep;
    };
    const up = async (e: PointerEvent) => {
      if (!drawRef.current.active) return;
      e.preventDefault();
      const s: DoodleStroke = { seqNo: seqRef.current, tool, color, width, points: drawRef.current.points };
      seqRef.current += 1;
      drawRef.current.active = false;
      strokesRef.current = [...strokesRef.current, s];
      dirtyRef.current = true;
      try {
        await saveDoodleFor(qid);
      } catch {}
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [noteVisible, penEnabled, tool, color, width, qid]);

  const switchQuestion = async (nextId: number) => {
    if (!nextId || nextId === qid) return;
    const currentId = qid;
    if (currentId) {
      try {
        await saveDoodleFor(currentId);
      } catch {
        setSaving(false);
        setNotice("当前题笔记保存失败，未切换题目。请稍后重试。");
        window.setTimeout(() => setNotice(""), 2200);
        return;
      }
    }
    setQid(nextId);
    setShowAnswer(lockAnswer);
  };

  const goNext = async () => {
    if (idx < 0 || idx >= orderedIds.length - 1) return;
    const nextId = orderedIds[idx + 1];
    if (!nextId) return;
    await switchQuestion(nextId);
  };

  const goPrev = async () => {
    if (idx <= 0) return;
    const prevId = orderedIds[idx - 1];
    if (!prevId) return;
    await switchQuestion(prevId);
  };

  const markStatus = async (status: QuestionStatus) => {
    if (!question) return;
    try {
      await saveDoodleFor(question.id);
    } catch {
      setNotice("当前题笔记保存失败，未切换题目。请稍后重试。");
      window.setTimeout(() => setNotice(""), 2200);
      return;
    }
    const nextId = idx >= 0 && idx < orderedIds.length - 1 ? orderedIds[idx + 1] : null;
    await submitAttempt(question.id, { status });
    await refresh(bankId, autoNextOnMark ? nextId ?? question.id : question.id);
  };

  const onBank = async (id: number) => {
    if (qid) {
      try {
        await saveDoodleFor(qid);
      } catch {
        setNotice("当前题笔记保存失败，未切换题库。请稍后重试。");
        window.setTimeout(() => setNotice(""), 2200);
        return;
      }
    }
    setBankId(id);
    await refresh(id);
  };

  const submitImportTask = async () => {
    setImporting(true);
    setImportMessage("");
    try {
      if (providerOpen && (!providerModelName.trim() || !providerBaseUrl.trim() || !providerApiKey.trim())) {
        setImportMessage("已展开高级连接时，请完整填写模型名、地址和 Key。");
        return;
      }
      if (importMode === "double") {
        if (!doubleQuestionFile || !doubleAnswerFile) {
          setImportMessage("请先选择题目文件和答案文件。");
          return;
        }
        if (!doubleMaterialName.trim()) {
          setImportMessage("请填写资料名称。");
          return;
        }
        await createImportTask({
          mode: "double",
          materialName: doubleMaterialName.trim(),
          questionFile: doubleQuestionFile,
          answerFile: doubleAnswerFile,
          providerModelName: providerOpen ? providerModelName : "",
          providerBaseUrl: providerOpen ? providerBaseUrl : "",
          providerApiKey: providerOpen ? providerApiKey : "",
        });
        await refreshImportTasks();
        setImportMessage("双本解析任务已提交，后端开始排队处理。");
      } else {
        if (!singleQuestionFile) {
          setImportMessage("请先选择单本文件。");
          return;
        }
        if (!singleMaterialName.trim()) {
          setImportMessage("请填写资料名称。");
          return;
        }
        const split = Number(singleSplitPage);
        if (!Number.isFinite(split) || split < 1) {
          setImportMessage("请填写正确的分割页（大于 0）。");
          return;
        }
        await createImportTask({
          mode: "single",
          materialName: singleMaterialName.trim(),
          splitPage: split,
          questionFile: singleQuestionFile,
          providerModelName: providerOpen ? providerModelName : "",
          providerBaseUrl: providerOpen ? providerBaseUrl : "",
          providerApiKey: providerOpen ? providerApiKey : "",
        });
        await refreshImportTasks();
        setImportMessage("单本解析任务已提交，后端开始排队处理。");
      }
    } catch (error) {
      console.error(error);
      setImportMessage("创建解析任务失败，请稍后重试。");
    } finally {
      setImporting(false);
    }
  };

  if (bootError) return <div className="h-full flex items-center justify-center text-red-600">{bootError}</div>;
  if (!qid) return <div className="h-full flex items-center justify-center">OpenNote 加载中...</div>;
  if (!question) return <div className="h-full flex items-center justify-center">{questionLoading ? "题目加载中..." : "OpenNote 加载中..."}</div>;

  const canDraw = noteVisible && penEnabled;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={() => setLeftOpen((v) => !v)}>
            {leftOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5" onClick={() => setImportOpen(true)}>
            <FileUp className="w-4 h-4" />
            导入
          </button>
          <select value={bankId} onChange={(e) => onBank(Number(e.target.value))} className="px-3 py-1.5 border rounded-lg text-sm">
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm text-gray-600">
          {idx + 1} / {orderedIds.length}
        </div>

        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={() => setToolOpen((v) => !v)} title="工具面板">
            <Wrench className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={() => setTaskOpen(true)} title="解析任务">
            <History className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={() => setSettingsOpen((v) => !v)} title="设置">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {leftOpen && (
          <aside className="w-64 bg-white border-r overflow-y-auto">
            <div className="p-3">
              <h2 className="font-medium mb-3 flex items-center gap-2 text-sm">
                <BookOpen className="w-4 h-4" />
                题目列表
              </h2>
              {chapters.map((ch) => {
                const open = expanded.has(ch.id);
                const list = questionIndex.filter((q) => q.chapterId === ch.id).sort((a, b) => a.sortNo - b.sortNo);
                return (
                  <div key={ch.id} className="mb-2">
                    <button
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
                      onClick={() => {
                        const s = new Set(expanded);
                        if (s.has(ch.id)) s.delete(ch.id);
                        else s.add(ch.id);
                        setExpanded(s);
                      }}
                    >
                      <div className="flex items-center gap-1.5 text-left">
                        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className="text-xs font-medium">{ch.title}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {ch.completedQuestions}/{ch.totalQuestions}
                      </span>
                    </button>
                    {open && (
                      <div className="px-2 mt-2">
                        <div className="text-xs text-gray-500 mb-2">正确率: {ch.accuracy}%</div>
                        <div className="grid grid-cols-5 gap-2">
                          {list.map((q) => (
                            <button key={q.id} onClick={() => switchQuestion(q.id)} className={`w-8 h-8 rounded-full text-xs border-2 ${chipClass(q.status, q.id === qid)}`}>
                              {q.sortNo}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
          <div
            ref={wrapRef}
            className="w-full h-full bg-white rounded-lg shadow-sm relative overflow-hidden select-none"
            style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as CSSProperties}
          >
            <div className="h-1/2 border-b p-6 overflow-auto">
              <div className="text-sm text-gray-500 mb-2">
                {(currentQuestionMeta?.chapterTitle || chapters.find((c) => c.id === question.chapterId)?.title)} · 题目 {currentQuestionMeta?.sortNo ?? question.sortNo}
              </div>
              <RichContent text={question.stem} fontScale={fontScale} />
            </div>
            <div className="h-1/2 p-6 overflow-auto">
              {showAnswer ? (
                <div className="p-4 rounded-lg border bg-blue-50 border-blue-200 text-blue-900">
                  <RichContent text={question.explanation} fontScale={fontScale} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">点击右侧眼睛显示答案</div>
              )}
            </div>
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 ${noteVisible ? "" : "hidden"}`}
              style={{ width: "100%", height: "100%", touchAction: "none", pointerEvents: canDraw ? "auto" : "none", cursor: canDraw ? "crosshair" : "default" }}
            />
          </div>
        </main>

        <aside className="w-16 bg-white border-l flex flex-col items-center py-4">
          <button className={`p-3 rounded-lg ${lockAnswer ? "bg-blue-100 text-blue-700" : "hover:bg-gray-100"}`} title="锁定答案" onClick={() => { setLockAnswer((v) => !v); if (!lockAnswer) setShowAnswer(true); }}>
            <div className="relative">
              <Eye className="w-5 h-5" />
              <Lock className="w-3 h-3 absolute -top-1 -right-1" />
            </div>
          </button>

          <button className={`p-3 rounded-lg mt-2 ${showAnswer ? "bg-blue-100 text-blue-700" : "hover:bg-gray-100"}`} title="显示答案" onClick={() => setShowAnswer((v) => !v)}>
            <Eye className="w-5 h-5" />
          </button>

          <button className={`p-3 rounded-lg mt-2 ${noteVisible ? "bg-blue-100 text-blue-700" : "hover:bg-gray-100"}`} title="显示笔记" onClick={() => setNoteVisible((v) => !v)}>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 18c4-10 8 10 16-6" /></svg>
          </button>

          <div className="relative mt-2">
            <button
              className={`p-3 rounded-lg ${penEnabled ? "bg-blue-100 text-blue-700" : "hover:bg-gray-100"}`}
              title="笔模式"
              onMouseDown={() => { holdTimerRef.current = window.setTimeout(() => setToolOpen(true), 450); }}
              onMouseUp={() => { if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current); }}
              onMouseLeave={() => { if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current); }}
              onClick={() => setPenEnabled((v) => !v)}
            >
              <Pen className="w-5 h-5" />
            </button>

            {toolOpen && (
              <div className="absolute right-full mr-2 top-0 bg-white border rounded-lg shadow p-3 w-44 z-20">
                <div className="text-xs text-gray-500 mb-2">工具</div>
                <div className="flex gap-2 mb-3">
                  <button className={`flex-1 p-2 rounded ${tool === "pen" ? "bg-blue-100" : "bg-gray-100"}`} onClick={() => setTool("pen")}>笔</button>
                  <button className={`flex-1 p-2 rounded ${tool === "eraser" ? "bg-blue-100" : "bg-gray-100"}`} onClick={() => setTool("eraser")}>橡皮</button>
                </div>
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {COLORS.map((c) => (
                    <button key={c} className="w-7 h-7 rounded border" style={{ backgroundColor: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
                <input type="range" min={1} max={20} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-full mb-3" />
                <button
                  className="w-full text-xs py-1 border rounded"
                  onClick={() => {
                    const last = undoRef.current.pop();
                    if (!last) return;
                    strokesRef.current = last;
                    dirtyRef.current = true;
                    redraw();
                    saveDoodleFor(qid).catch(() => undefined);
                  }}
                >
                  撤销
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button className="p-2 rounded-lg hover:bg-gray-100" onClick={goPrev} title="上一题">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button className="p-2 rounded-lg hover:bg-gray-100" onClick={goNext} title="下一题">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <div className="mt-auto mb-8 flex flex-col gap-3">
            <button className="p-3 rounded-lg bg-green-100 text-green-700 hover:bg-green-200" onClick={() => markStatus("correct")} title="标记正确"><Check className="w-5 h-5" /></button>
            <button className="p-3 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200" onClick={() => markStatus("wrong")} title="标记错误"><X className="w-5 h-5" /></button>
          </div>
        </aside>
      </div>

      <footer className="h-9 bg-white border-t text-xs text-gray-500 px-4 flex items-center justify-between">
        <span>OpenNote · 进度 {progress?.completed ?? 0}/{progress?.total ?? 0} · 正确率 {progress?.accuracy ?? 0}%</span>
        <span>{saving ? "笔记保存中..." : autoNextOnMark ? "批改后自动下一题: 开" : "批改后自动下一题: 关"}</span>
      </footer>
      {notice ? <div className="fixed bottom-12 left-1/2 -translate-x-1/2 bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg text-sm z-40">{notice}</div> : null}

      {settingsOpen && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-30" onClick={() => setSettingsOpen(false)}>
          <div className="w-[360px] bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4">设置</div>
            <label className="flex items-center justify-between text-sm mb-4">
              <span>批改后自动下一题</span>
              <input type="checkbox" checked={autoNextOnMark} onChange={(e) => setAutoNextOnMark(e.target.checked)} />
            </label>
            <div className="text-sm mb-2">字体大小</div>
            <input type="range" min="0.9" max="1.3" step="0.05" value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} className="w-full" />
            <div className="text-xs text-amber-600 mt-2">调整字体可能会使笔记错位，请确认后调整</div>
            <div className="mt-4 flex justify-end">
              <button className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50" onClick={() => setSettingsOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-30" onClick={() => setImportOpen(false)}>
          <div className="w-[620px] max-w-[92vw] bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4">题库解析导入</div>
            <div className="inline-flex rounded-lg border p-1 mb-4">
              <button
                className={`px-3 py-1.5 text-sm rounded ${importMode === "single" ? "bg-blue-100 text-blue-700" : "text-gray-600"}`}
                onClick={() => setImportMode("single")}
              >
                单本
              </button>
              <button
                className={`px-3 py-1.5 text-sm rounded ${importMode === "double" ? "bg-blue-100 text-blue-700" : "text-gray-600"}`}
                onClick={() => setImportMode("double")}
              >
                双本
              </button>
            </div>

            {importMode === "double" ? (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-gray-700">资料名称</span>
                  <input
                    type="text"
                    value={doubleMaterialName}
                    onChange={(e) => setDoubleMaterialName(e.target.value)}
                    placeholder="例如：2026 判断推理上/下册"
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">题目文件</span>
                  <label className="mt-1 flex items-center justify-between w-full border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <span className="text-xs text-gray-600 truncate">{doubleQuestionFile?.name ?? "未选择文件"}</span>
                    <span className="text-xs text-blue-600">选择文件</span>
                    <input type="file" className="hidden" onChange={(e) => setDoubleQuestionFile(e.target.files?.[0] ?? null)} />
                  </label>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">答案文件</span>
                  <label className="mt-1 flex items-center justify-between w-full border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <span className="text-xs text-gray-600 truncate">{doubleAnswerFile?.name ?? "未选择文件"}</span>
                    <span className="text-xs text-blue-600">选择文件</span>
                    <input type="file" className="hidden" onChange={(e) => setDoubleAnswerFile(e.target.files?.[0] ?? null)} />
                  </label>
                </label>
                <div className="text-xs text-gray-500">文件只保留在本地，点击“提交任务”后才会发往 API。</div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-gray-700">资料名称</span>
                  <input
                    type="text"
                    value={singleMaterialName}
                    onChange={(e) => setSingleMaterialName(e.target.value)}
                    placeholder="例如：2026 判断推理单册"
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">题目/答案单本文件</span>
                  <label className="mt-1 flex items-center justify-between w-full border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <span className="text-xs text-gray-600 truncate">{singleQuestionFile?.name ?? "未选择文件"}</span>
                    <span className="text-xs text-blue-600">选择文件</span>
                    <input type="file" className="hidden" onChange={(e) => setSingleQuestionFile(e.target.files?.[0] ?? null)} />
                  </label>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">答案题目分割页</span>
                  <input
                    type="number"
                    min={1}
                    value={singleSplitPage}
                    onChange={(e) => setSingleSplitPage(e.target.value)}
                    placeholder="例如: 120"
                    className="mt-1 w-full border rounded-lg px-3 py-2"
                  />
                </label>
                <div className="text-xs text-gray-500">分割页表示从该页开始进入答案区。文件只会在点击提交后上传。</div>
              </div>
            )}

            <div className="mt-4 border rounded-lg">
              <button
                className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-50 rounded-lg"
                onClick={() => setProviderOpen((v) => !v)}
              >
                <span>高级连接（可选）</span>
                <span className="text-xs text-gray-500">{providerOpen ? "收起" : "展开"}</span>
              </button>
              {providerOpen && (
                <div className="px-3 pb-3 space-y-3">
                  <label className="block text-sm">
                    <span className="text-gray-700">模型名</span>
                    <input
                      type="text"
                      value={providerModelName}
                      onChange={(e) => setProviderModelName(e.target.value)}
                      placeholder="例如：gpt-4.1 / qwen-vl-max"
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">地址</span>
                    <input
                      type="text"
                      value={providerBaseUrl}
                      onChange={(e) => setProviderBaseUrl(e.target.value)}
                      placeholder="例如：http://127.0.0.1:8000/v1"
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">Key</span>
                    <input
                      type="password"
                      value={providerApiKey}
                      onChange={(e) => setProviderApiKey(e.target.value)}
                      placeholder="你的 API Key"
                      className="mt-1 w-full border rounded-lg px-3 py-2"
                    />
                  </label>
                </div>
              )}
            </div>

            {importMessage ? <div className="mt-3 text-xs text-gray-600">{importMessage}</div> : null}

            <div className="mt-5 flex justify-end gap-2">
              <button className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50" onClick={() => setImportOpen(false)}>
                关闭
              </button>
              <button disabled={importing} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300" onClick={submitImportTask}>
                {importing ? "提交中..." : "提交任务"}
              </button>
            </div>
          </div>
        </div>
      )}

      {taskOpen && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-30" onClick={() => setTaskOpen(false)}>
          <div className="w-[560px] max-w-[92vw] bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4">题库解析任务</div>
            <div className="max-h-[55vh] overflow-auto border rounded-lg">
              {parseTasks.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">暂无解析任务。请先在左上角“导入”中提交。</div>
              ) : (
                <div className="divide-y">
                  {parseTasks.map((task) => (
                    <div key={task.id} className="p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{task.mode === "double" ? "双本解析" : "单本解析"}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                          {task.status === "queued" ? "排队中" : task.status === "running" ? "处理中" : task.status === "done" ? "已完成" : "失败"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{task.createdAt}</div>
                      <div className="text-xs text-gray-700 mt-1">
                        资料: {task.materialName} / 题目: {task.questionFileName}
                        {task.answerFileName ? ` / 答案: ${task.answerFileName}` : ""}
                        {task.splitPage ? ` / 分割页: ${task.splitPage}` : ""}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">模型来源: {task.providerLabel}</div>
                      {typeof task.importedQuestionCount === "number" ? (
                        <div className="text-xs text-emerald-700 mt-1">
                          已入库: 题库 {task.importedBankId ?? "-"} / {task.importedQuestionCount} 题
                        </div>
                      ) : null}
                      {task.matchReport?.summary ? (
                        <div className="text-xs text-gray-500 mt-1">
                          匹配: {task.matchReport.summary.questions ?? 0} 题 / {task.matchReport.summary.answers ?? 0} 答
                        </div>
                      ) : null}
                      {task.warnings.length > 0 ? <div className="text-xs text-amber-700 mt-1">{task.warnings[0]}</div> : null}
                      {task.lastError ? <div className="text-xs text-rose-700 mt-1">{task.lastError}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50" onClick={() => setTaskOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
