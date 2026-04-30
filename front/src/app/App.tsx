import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Menu, X, Eye, EyeOff, Flag, FileText, Pen, Eraser, RotateCcw, Trash2, Settings, BarChart3, BookOpen } from 'lucide-react';

// 测试数据结构
interface Question {
  id: number;
  type: 'fill' | 'choice';
  question: string;
  options?: string[];
  answer: string;
  correctAnswer?: number; // 选择题的正确答案索引
  status: 'correct' | 'wrong' | 'unanswered';
  note?: string;
  drawing?: string; // base64编码的涂鸦数据
}

interface Chapter {
  id: number;
  name: string;
  questions: Question[];
}

interface QuestionBank {
  id: string;
  name: string;
  chapters: Chapter[];
}

// 测试题库数据
const mockQuestionBanks: QuestionBank[] = [
  {
    id: 'bank1',
    name: '数据结构与算法',
    chapters: [
      {
        id: 1,
        name: '第一章 数组与链表',
        questions: [
          {
            id: 1,
            type: 'fill',
            question: '数组的时间复杂度是 ______，链表的插入时间复杂度是 ______。',
            answer: 'O(1) 查找、O(n) 插入；O(1) 插入',
            status: 'correct'
          },
          {
            id: 2,
            type: 'choice',
            question: '下列哪种数据结构适合实现LRU缓存？',
            options: ['数组', '哈希表 + 双向链表', '栈', '队列'],
            answer: '哈希表 + 双向链表可以在O(1)时间内完成查找和更新操作。',
            correctAnswer: 1,
            status: 'unanswered'
          },
          {
            id: 3,
            type: 'choice',
            question: '单向链表反转的时间复杂度是多少？',
            options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'],
            answer: '遍历一遍链表即可完成反转，时间复杂度为O(n)。',
            correctAnswer: 2,
            status: 'wrong'
          }
        ]
      },
      {
        id: 2,
        name: '第二章 栈与队列',
        questions: [
          {
            id: 4,
            type: 'fill',
            question: '用两个栈可以实现一个 ______。',
            answer: '队列',
            status: 'correct'
          },
          {
            id: 5,
            type: 'choice',
            question: '下列哪个场景适合使用栈？',
            options: ['广度优先搜索', '函数调用', '打印队列', '缓存淘汰'],
            answer: '函数调用需要后进先出的特性，使用栈来保存调用帧。',
            correctAnswer: 1,
            status: 'unanswered'
          },
          {
            id: 6,
            type: 'fill',
            question: '单调栈可以在 ______ 时间内找到数组中每个元素的下一个更大元素。',
            answer: 'O(n)',
            status: 'unanswered'
          }
        ]
      }
    ]
  },
  {
    id: 'bank2',
    name: '计算机网络',
    chapters: [
      {
        id: 3,
        name: '第一章 HTTP协议',
        questions: [
          {
            id: 7,
            type: 'choice',
            question: 'HTTP状态码404表示什么？',
            options: ['服务器错误', '未找到资源', '请求成功', '重定向'],
            answer: '404 Not Found表示请求的资源不存在。',
            correctAnswer: 1,
            status: 'correct'
          },
          {
            id: 8,
            type: 'fill',
            question: 'HTTPS使用 ______ 协议进行加密传输。',
            answer: 'TLS/SSL',
            status: 'unanswered'
          },
          {
            id: 9,
            type: 'choice',
            question: 'GET和POST的主要区别是什么？',
            options: ['安全性', '参数位置', '幂等性', '以上都是'],
            answer: 'GET请求参数在URL中，是幂等的；POST参数在请求体中，非幂等。',
            correctAnswer: 3,
            status: 'unanswered'
          },
          {
            id: 10,
            type: 'fill',
            question: 'HTTP/2相比HTTP/1.1的主要优势是 ______ 和 ______。',
            answer: '多路复用；头部压缩',
            status: 'unanswered'
          }
        ]
      }
    ]
  }
];

export default function App() {
  const [questionBanks] = useState<QuestionBank[]>(mockQuestionBanks);
  const [currentBankId, setCurrentBankId] = useState(questionBanks[0].id);
  const [currentQuestionId, setCurrentQuestionId] = useState(1);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set([1]));
  const [showAnswer, setShowAnswer] = useState(false);
  const [showDrawing, setShowDrawing] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingTool, setDrawingTool] = useState<'pen' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  const [showToolExpanded, setShowToolExpanded] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawingHistory, setDrawingHistory] = useState<ImageData[]>([]);

  const currentBank = questionBanks.find(b => b.id === currentBankId)!;
  const allQuestions = currentBank.chapters.flatMap(c => c.questions);
  const currentQuestion = allQuestions.find(q => q.id === currentQuestionId)!;
  const currentChapter = currentBank.chapters.find(c => c.questions.some(q => q.id === currentQuestionId))!;

  // 计算统计数据
  const getChapterStats = (chapter: Chapter) => {
    const total = chapter.questions.length;
    const completed = chapter.questions.filter(q => q.status !== 'unanswered').length;
    const correct = chapter.questions.filter(q => q.status === 'correct').length;
    const accuracy = completed > 0 ? Math.round((correct / completed) * 100) : 0;
    return { total, completed, accuracy };
  };

  // 切换章节展开/收起
  const toggleChapter = (chapterId: number) => {
    const newExpanded = new Set(expandedChapters);
    if (newExpanded.has(chapterId)) {
      newExpanded.delete(chapterId);
    } else {
      newExpanded.add(chapterId);
    }
    setExpandedChapters(newExpanded);
  };

  // 切换题目
  const goToQuestion = (questionId: number) => {
    setCurrentQuestionId(questionId);
    setShowAnswer(false);
    setSelectedAnswer(null);
  };

  // 上一题/下一题
  const goToPrevQuestion = () => {
    const currentIndex = allQuestions.findIndex(q => q.id === currentQuestionId);
    if (currentIndex > 0) {
      goToQuestion(allQuestions[currentIndex - 1].id);
    }
  };

  const goToNextQuestion = () => {
    const currentIndex = allQuestions.findIndex(q => q.id === currentQuestionId);
    if (currentIndex < allQuestions.length - 1) {
      goToQuestion(allQuestions[currentIndex + 1].id);
    }
  };

  // 标记错题
  const toggleWrongMark = () => {
    currentQuestion.status = currentQuestion.status === 'wrong' ? 'correct' : 'wrong';
  };

  // 选择题选择答案
  const handleChoiceSelect = (index: number) => {
    setSelectedAnswer(index);
    if (currentQuestion.correctAnswer !== undefined) {
      currentQuestion.status = index === currentQuestion.correctAnswer ? 'correct' : 'wrong';
    }
  };

  // Canvas绘图逻辑
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // 设置canvas尺寸
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.offsetWidth;
        canvas.height = parent.offsetHeight;
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    const startDrawing = (e: MouseEvent | TouchEvent) => {
      if (!showDrawing) return;

      drawing = true;
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      lastX = clientX - rect.left;
      lastY = clientY - rect.top;

      // 保存当前状态到历史记录
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setDrawingHistory(prev => [...prev, imageData]);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!drawing || !showDrawing) return;

      e.preventDefault(); // 防止滚动

      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);

      if (drawingTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = penWidth * 3;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = penColor;
        ctx.lineWidth = penWidth;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      lastX = x;
      lastY = y;
    };

    const stopDrawing = () => {
      drawing = false;
    };

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // 触摸事件（iPad支持）
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    return () => {
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseout', stopDrawing);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [showDrawing, drawingTool, penColor, penWidth]);

  // 撤销功能
  const undoDrawing = () => {
    if (drawingHistory.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const lastState = drawingHistory[drawingHistory.length - 1];
    ctx.putImageData(lastState, 0, 0);
    setDrawingHistory(prev => prev.slice(0, -1));
  };

  // 清空涂鸦
  const clearDrawing = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawingHistory([]);
  };

  return (
    <div className="size-full flex flex-col bg-gray-50">
      {/* 顶部工具栏 */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            {leftSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <select
            value={currentBankId}
            onChange={(e) => setCurrentBankId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            {questionBanks.map(bank => (
              <option key={bank.id} value={bank.id}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevQuestion}
            disabled={allQuestions[0].id === currentQuestionId}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一题
          </button>
          <span className="text-sm text-gray-600">
            {allQuestions.findIndex(q => q.id === currentQuestionId) + 1} / {allQuestions.length}
          </span>
          <button
            onClick={goToNextQuestion}
            disabled={allQuestions[allQuestions.length - 1].id === currentQuestionId}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一题
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-gray-100 rounded-lg" title="学习统计">
            <BarChart3 className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded-lg" title="设置">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧边栏 - 题目列表 */}
        {leftSidebarOpen && (
          <aside className="w-56 bg-white border-r border-gray-200 overflow-y-auto shrink-0">
            <div className="p-3">
              <h2 className="font-medium text-gray-900 mb-3 flex items-center gap-2 text-sm">
                <BookOpen className="w-4 h-4" />
                题目列表
              </h2>

              {currentBank.chapters.map(chapter => {
                const stats = getChapterStats(chapter);
                const isExpanded = expandedChapters.has(chapter.id);

                return (
                  <div key={chapter.id} className="mb-2">
                    <button
                      onClick={() => toggleChapter(chapter.id)}
                      className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className="text-xs font-medium">{chapter.name}</span>
                      </div>
                      <span className="text-xs text-gray-500">{stats.completed}/{stats.total}</span>
                    </button>

                    {isExpanded && (
                      <div className="ml-2 mt-2 space-y-2">
                        <div className="text-xs text-gray-500 px-2">
                          正确率: {stats.accuracy}%
                        </div>
                        <div className="grid grid-cols-5 gap-2 px-2">
                          {chapter.questions.map(q => (
                            <button
                              key={q.id}
                              onClick={() => goToQuestion(q.id)}
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                                q.id === currentQuestionId
                                  ? 'border-blue-300 bg-blue-200 text-blue-700'
                                  : q.status === 'correct'
                                  ? 'border-[#CBFCC0] bg-[#CBFCC0] text-green-800'
                                  : q.status === 'wrong'
                                  ? 'border-[#F9B2C0] bg-[#F9B2C0] text-rose-800'
                                  : 'border-gray-200 bg-gray-50 text-gray-600'
                              }`}
                              title={`题目 ${q.id}`}
                            >
                              {q.id}
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

        {/* 中间内容区 */}
        <main className="flex-1 flex flex-col overflow-hidden p-8">
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-4xl h-[600px] bg-white rounded-lg shadow-sm relative overflow-hidden">
              {/* 题目部分 - 上半部分 */}
              <div className="h-1/2 p-8 border-b border-gray-200 overflow-y-auto">
                <div className="text-sm text-gray-500 mb-2">
                  {currentChapter.name} · 题目 {currentQuestion.id}
                </div>
                <div className="text-lg mb-4">
                  <span className="inline-block bg-blue-100 text-blue-900 text-xs px-2 py-1 rounded mr-2">
                    {currentQuestion.type === 'fill' ? '填空题' : '选择题'}
                  </span>
                  {currentQuestion.question}
                </div>

                {/* 选择题选项 */}
                {currentQuestion.type === 'choice' && currentQuestion.options && (
                  <div className="space-y-2">
                    {currentQuestion.options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => handleChoiceSelect(index)}
                        className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                          selectedAnswer === index
                            ? currentQuestion.correctAnswer === index
                              ? 'border-green-500 bg-green-50'
                              : 'border-red-500 bg-red-50'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <span className="font-medium mr-2">{String.fromCharCode(65 + index)}.</span>
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 答案部分 - 下半部分 */}
              <div className="h-1/2 p-8 overflow-y-auto">
                {showAnswer ? (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="font-medium text-blue-900 mb-2">答案解析：</div>
                    <div className="text-blue-800">{currentQuestion.answer}</div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    点击右侧"显示答案"按钮查看答案
                  </div>
                )}
              </div>

              {/* 涂鸦Canvas - 覆盖整个区域，居中对齐 */}
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 pointer-events-auto ${showDrawing ? '' : 'hidden'}`}
                style={{
                  touchAction: 'none',
                  cursor: drawingTool === 'eraser' ? 'crosshair' : 'crosshair'
                }}
              />
            </div>
          </div>
        </main>

        {/* 右侧工具栏 */}
        <aside className="w-16 bg-white border-l border-gray-200 flex flex-col items-center py-4 gap-4 shrink-0">
          <button
            onClick={() => setShowAnswer(!showAnswer)}
            className={`p-3 rounded-lg ${showAnswer ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
            title={showAnswer ? '隐藏答案' : '显示答案'}
          >
            {showAnswer ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>

          <button
            onClick={toggleWrongMark}
            className={`p-3 rounded-lg ${currentQuestion.status === 'wrong' ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100'}`}
            title="标记错题"
          >
            <Flag className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowDrawing(!showDrawing)}
            className={`p-3 rounded-lg ${showDrawing ? 'bg-purple-100 text-purple-600' : 'hover:bg-gray-100'}`}
            title={showDrawing ? '隐藏笔记' : '显示笔记'}
          >
            <FileText className="w-5 h-5" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowToolExpanded(!showToolExpanded)}
              className={`p-3 rounded-lg ${showToolExpanded ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100'}`}
              title="书写工具"
            >
              <Pen className="w-5 h-5" />
            </button>

            {/* 书写工具展开面板 */}
            {showToolExpanded && (
              <div className="absolute right-full mr-2 top-0 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-48">
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-600 mb-2 block">工具</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDrawingTool('pen')}
                        className={`flex-1 p-2 rounded ${drawingTool === 'pen' ? 'bg-blue-100' : 'bg-gray-100'}`}
                      >
                        <Pen className="w-4 h-4 mx-auto" />
                      </button>
                      <button
                        onClick={() => setDrawingTool('eraser')}
                        className={`flex-1 p-2 rounded ${drawingTool === 'eraser' ? 'bg-blue-100' : 'bg-gray-100'}`}
                      >
                        <Eraser className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600 mb-2 block">颜色</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'].map(color => (
                        <button
                          key={color}
                          onClick={() => setPenColor(color)}
                          className={`w-8 h-8 rounded border-2 ${penColor === color ? 'border-gray-900' : 'border-gray-300'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600 mb-2 block">笔宽: {penWidth}px</label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={penWidth}
                      onChange={(e) => setPenWidth(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    <button
                      onClick={undoDrawing}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 rounded"
                    >
                      <RotateCcw className="w-4 h-4" />
                      撤销
                    </button>
                    <button
                      onClick={clearDrawing}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 rounded text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                      清空
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}