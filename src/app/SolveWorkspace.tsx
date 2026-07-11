import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  ArrowLeft,
  Check,
  Eraser,
  Loader2,
  MessageCircle,
  Minus,
  Pause,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api } from "./api";
import { strokeIntersectsPoint, type DrawTool, type EraserMode, type Point, type Stroke } from "./drawing";
import type { ProblemChatMessage, ProblemDetail } from "./types";
import "./solve-workspace.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDFJS_ASSET_BASE = "/pdfjs";
const RESULT_LABELS: Record<string, string> = {
  correct: "解けた",
  partial: "途中まで",
  wrong: "解けなかった",
  skipped: "見送った",
};

type CanvasSyncStatus = "loading" | "saved" | "saving" | "offline";
type ChatStatus = "idle" | "sending";

function formatStopwatch(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function problemPdfUrl(problemId: string) {
  return `/api/problem-pdf?id=${encodeURIComponent(problemId)}`;
}

function pageRange(problem: ProblemDetail) {
  const start = Math.max(1, problem.page_start ?? 1);
  const end = Math.max(start, problem.page_end ?? start);
  return { start, end };
}

export function SolveWorkspacePage() {
  const problemId = new URLSearchParams(window.location.search).get("id") ?? "";
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!problemId) {
        setError("解く問題が指定されていません。");
        return;
      }
      try {
        const response = await api.problem(problemId);
        if (!cancelled) setProblem(response.problem);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "問題を読み込めませんでした。");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  if (error) {
    return (
      <main className="solve-loading">
        <strong>問題を開けませんでした</strong>
        <p>{error}</p>
        <a href="/">演習帳へ戻る</a>
      </main>
    );
  }
  if (!problem) return <main className="solve-loading">解答画面を準備しています...</main>;
  return <SolveWorkspace key={problem.id} problem={problem} />;
}

function SolveWorkspace({ problem }: { problem: ProblemDetail }) {
  const startedAt = useRef(new Date().toISOString());
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [eraserMode, setEraserMode] = useState<EraserMode>("pixel");
  const [penWidth, setPenWidth] = useState(3);
  const [zoom, setZoom] = useState(0.9);
  const [pdfRatio, setPdfRatio] = useState(() => Number(localStorage.getItem("solve-pdf-ratio")) || 50);
  const [finishOpen, setFinishOpen] = useState(false);
  const [result, setResult] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [canvasSyncStatus, setCanvasSyncStatus] = useState<CanvasSyncStatus>("loading");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ProblemChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState<ChatStatus>("idle");
  const [chatError, setChatError] = useState<string | null>(null);
  const drawingRef = useRef<DrawingCanvasHandle | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pages = pageRange(problem);

  useEffect(() => {
    if (!timerRunning) return undefined;
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    localStorage.setItem("solve-pdf-ratio", String(pdfRatio));
  }, [pdfRatio]);

  useEffect(() => {
    if (!chatOpen) return;
    window.setTimeout(() => chatInputRef.current?.focus(), 0);
  }, [chatOpen]);

  function openFinish() {
    setTimerRunning(false);
    setMinutes(String(Math.max(1, Math.ceil(elapsedSeconds / 60))));
    setFinishOpen(true);
  }

  function closeFinish() {
    if (saving || saved) return;
    setFinishOpen(false);
    setTimerRunning(true);
  }

  async function saveAttempt() {
    if (!result) {
      setSaveError("結果を選んでください。");
      return;
    }
    const parsedMinutes = Number(minutes);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
      setSaveError("所要時間を0以上の数字で入力してください。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.createAttempt({
        problem_id: problem.id,
        started_at: startedAt.current,
        result,
        time_spent_minutes: Math.round(parsedMinutes),
        note,
        used_hint: false,
        looked_solution: false,
      });
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "学習記録を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function sendChatMessage() {
    const content = chatInput.trim();
    if (!content || chatStatus === "sending") return;
    const nextMessages: ProblemChatMessage[] = [...chatMessages, { role: "user", content }];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatStatus("sending");
    setChatError(null);
    try {
      const response = await api.askProblemChat(problem.id, nextMessages);
      setChatMessages([...nextMessages, { role: "assistant", content: response.answer }]);
    } catch (error) {
      setChatMessages(nextMessages);
      setChatError(error instanceof Error ? error.message : "回答を生成できませんでした。");
    } finally {
      setChatStatus("idle");
    }
  }

  function handleChatKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendChatMessage();
    }
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    const container = splitRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setPdfRatio(Math.min(70, Math.max(30, next)));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPdfRatio((current) => Math.max(30, current - 5));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setPdfRatio((current) => Math.min(70, current + 5));
    }
  }

  return (
    <main className="solve-workspace">
      <header className="solve-toolbar">
        <div className="solve-identity">
          <a href="/" aria-label="演習帳へ戻る" title="演習帳へ戻る"><ArrowLeft /></a>
          <div>
            <strong>{problem.university} {problem.exam_year} {problem.problem_label}</strong>
            <span>{problem.subject_raw ?? problem.graduate_school ?? "大学院入試問題"}</span>
          </div>
        </div>

        <div className="solve-tools" role="toolbar" aria-label="解答ツール">
          <div className="tool-group drawing-tools" aria-label="描画ツール">
            <button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")} aria-label="ペン" title="ペン"><PenLine /></button>
            <button
              className={tool === "eraser" && eraserMode === "pixel" ? "active" : ""}
              onClick={() => { setTool("eraser"); setEraserMode("pixel"); }}
              aria-label="部分消しゴム"
              title="部分消しゴム"
            ><Eraser /></button>
            <button
              className={`object-eraser-button ${tool === "eraser" && eraserMode === "object" ? "active" : ""}`}
              onClick={() => { setTool("eraser"); setEraserMode("object"); }}
              aria-label="一画消しゴム"
              title="触れた一画をまとめて消す"
            ><ScanLine /><span>一画消し</span></button>
            <label className="pen-size" title="線の太さ">
              <span>太さ</span>
              <input type="range" min="1" max="9" value={penWidth} onChange={(event) => setPenWidth(Number(event.target.value))} />
            </label>
            <button onClick={() => drawingRef.current?.undo()} aria-label="一つ戻す" title="一つ戻す"><Undo2 /></button>
            <button onClick={() => drawingRef.current?.clear()} aria-label="キャンバスを消去" title="キャンバスを消去"><Trash2 /></button>
          </div>

          <div className="tool-group zoom-tools" aria-label="PDF表示倍率">
            <button onClick={() => setZoom((current) => Math.max(0.55, current - 0.1))} aria-label="PDFを縮小" title="PDFを縮小"><Minus /></button>
            <output>{Math.round(zoom * 100)}%</output>
            <button onClick={() => setZoom((current) => Math.min(2, current + 0.1))} aria-label="PDFを拡大" title="PDFを拡大"><Plus /></button>
          </div>

          <div className="tool-group timer-tool">
            <button onClick={() => setTimerRunning((current) => !current)} aria-label={timerRunning ? "タイマーを一時停止" : "タイマーを再開"} title={timerRunning ? "一時停止" : "再開"}>
              {timerRunning ? <Pause /> : <Play />}
            </button>
            <time>{formatStopwatch(elapsedSeconds)}</time>
          </div>
          <button className="finish-button" onClick={openFinish}><Save />終了して記録</button>
        </div>
      </header>

      <div
        ref={splitRef}
        className="solve-split"
        style={{ "--pdf-ratio": `${pdfRatio}%` } as React.CSSProperties}
      >
        <section className="solve-pdf-pane" aria-label="問題PDF">
          <div className="pane-label">
            <span>問題PDF</span>
            <small>{pages.start === pages.end ? `${pages.start}ページ` : `${pages.start}-${pages.end}ページ`}</small>
          </div>
          <PdfProblemViewer
            sourceUrl={problemPdfUrl(problem.id)}
            originalUrl={problem.source_url ?? undefined}
            startPage={pages.start}
            endPage={pages.end}
            zoom={zoom}
          />
        </section>

        <button
          className="split-handle"
          onPointerDown={beginResize}
          onKeyDown={resizeWithKeyboard}
          aria-label={`PDFと解答欄の幅を調整。PDF ${Math.round(pdfRatio)}パーセント`}
          title="左右にドラッグして幅を調整"
        ><span /></button>

        <section className="solve-canvas-pane" aria-label="解答キャンバス">
          <div className="pane-label">
            <span>解答キャンバス</span>
            <small className={`canvas-sync ${canvasSyncStatus}`}>
              {canvasSyncStatus === "loading" ? "読み込み中" : canvasSyncStatus === "saving" ? "保存中..." : canvasSyncStatus === "saved" ? "保存済み" : "この端末に保存"}
            </small>
          </div>
          <DrawingCanvas
            ref={drawingRef}
            problemId={problem.id}
            tool={tool}
            eraserMode={eraserMode}
            width={penWidth}
            onSyncStatus={setCanvasSyncStatus}
          />
        </section>
      </div>

      <button
        className="problem-chat-launcher"
        onClick={() => setChatOpen(true)}
        aria-label="AIチャットを開く"
        title="AIチャット"
      >
        <MessageCircle />
      </button>

      {chatOpen ? (
        <aside className="problem-chat-drawer" aria-label="問題AIチャット">
          <div className="problem-chat-head">
            <div>
              <span>AIチャット</span>
              <strong>{problem.problem_label}</strong>
            </div>
            <button onClick={() => setChatOpen(false)} aria-label="AIチャットを閉じる" title="閉じる"><X /></button>
          </div>
          <div className="problem-chat-context">
            <span>{problem.university} {problem.exam_year}</span>
            <small>{pages.start === pages.end ? `${pages.start}ページ` : `${pages.start}-${pages.end}ページ`}</small>
          </div>
          <div className="problem-chat-messages" aria-live="polite">
            {chatMessages.length === 0 ? (
              <div className="problem-chat-empty">
                <MessageCircle />
                <p>どこで詰まっていますか？</p>
              </div>
            ) : chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`problem-chat-message ${message.role}`}>
                <p>{message.content}</p>
              </div>
            ))}
            {chatStatus === "sending" ? (
              <div className="problem-chat-message assistant pending">
                <Loader2 />
                <p>考えています...</p>
              </div>
            ) : null}
          </div>
          {chatError ? <p className="problem-chat-error">{chatError}</p> : null}
          <form
            className="problem-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendChatMessage();
            }}
          >
            <label htmlFor="problem-chat-input" className="sr-only">質問</label>
            <textarea
              ref={chatInputRef}
              id="problem-chat-input"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={handleChatKeyDown}
              rows={3}
              maxLength={1200}
              placeholder="この問題について質問"
              disabled={chatStatus === "sending"}
            />
            <button type="submit" disabled={!chatInput.trim() || chatStatus === "sending"} aria-label="送信" title="送信">
              {chatStatus === "sending" ? <Loader2 className="chat-spinner" /> : <Send />}
            </button>
          </form>
        </aside>
      ) : null}

      {finishOpen ? (
        <div className="finish-backdrop" role="dialog" aria-modal="true" aria-label="学習記録">
          <section className="finish-dialog">
            <div className="finish-head">
              <div>
                <span>学習記録</span>
                <h1>{saved ? "保存しました" : "結果を記録する"}</h1>
              </div>
              {!saved ? <button onClick={closeFinish} aria-label="閉じる"><X /></button> : null}
            </div>
            {saved ? (
              <div className="finish-success">
                <Check />
                <p>所要時間と結果を、おすすめ演習と復習時期に反映しました。</p>
                <a href="/">演習帳へ戻る</a>
              </div>
            ) : (
              <>
                <div className="result-options">
                  {Object.entries(RESULT_LABELS).map(([value, label]) => (
                    <button key={value} className={result === value ? "active" : ""} onClick={() => setResult(value)}>{label}</button>
                  ))}
                </div>
                <label className="finish-field">
                  <span>所要時間（分）</span>
                  <input value={minutes} onChange={(event) => setMinutes(event.target.value)} inputMode="numeric" />
                </label>
                <label className="finish-field">
                  <span>復習メモ</span>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="詰まったところ、次に確認すること" />
                </label>
                {saveError ? <p className="finish-error">{saveError}</p> : null}
                <div className="finish-actions">
                  <button className="secondary" onClick={closeFinish}>解答に戻る</button>
                  <button onClick={() => void saveAttempt()} disabled={saving}>{saving ? "保存中..." : "学習記録を保存"}</button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PdfProblemViewer({ sourceUrl, originalUrl, startPage, endPage, zoom }: {
  sourceUrl: string;
  originalUrl?: string;
  startPage: number;
  endPage: number;
  zoom: number;
}) {
  const [document, setDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument({
      url: sourceUrl,
      cMapPacked: true,
      cMapUrl: `${PDFJS_ASSET_BASE}/cmaps/`,
      iccUrl: `${PDFJS_ASSET_BASE}/iccs/`,
      standardFontDataUrl: `${PDFJS_ASSET_BASE}/standard_fonts/`,
      wasmUrl: `${PDFJS_ASSET_BASE}/wasm/`,
      rangeChunkSize: 256 * 1024,
    });
    task.promise
      .then((nextDocument) => {
        if (!cancelled) setDocument(nextDocument);
      })
      .catch((loadError) => {
        console.error("PDF load failed", loadError);
        if (!cancelled) setError("PDFを表示できませんでした。");
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [sourceUrl]);

  const pageNumbers = useMemo(() => {
    if (!document) return [];
    const safeStart = Math.min(Math.max(1, startPage), document.numPages);
    const safeEnd = Math.min(Math.max(safeStart, endPage), document.numPages);
    return Array.from({ length: safeEnd - safeStart + 1 }, (_, index) => safeStart + index);
  }, [document, endPage, startPage]);

  if (error) {
    return (
      <div className="solve-pdf-error">
        <strong>{error}</strong>
        <a href={`${sourceUrl}#page=${startPage}`} target="_blank" rel="noreferrer">保存済みPDFを別タブで開く</a>
        {originalUrl ? <a className="secondary" href={`${originalUrl.split("#")[0]}#page=${startPage}`} target="_blank" rel="noreferrer">大学の元PDFを開く</a> : null}
      </div>
    );
  }
  if (!document) return <div className="solve-pdf-loading">PDFを読み込んでいます...</div>;
  return (
    <div className="solve-pdf-pages">
      {pageNumbers.map((pageNumber) => <PdfPage key={pageNumber} document={document} pageNumber={pageNumber} zoom={zoom} />)}
    </div>
  );
}

function PdfPage({ document, pageNumber, zoom }: { document: pdfjsLib.PDFDocumentProxy; pageNumber: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    async function render() {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const deviceScale = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom });
        const renderViewport = page.getViewport({ scale: zoom * deviceScale });
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        await renderTask.promise;
      } catch (renderError) {
        if ((renderError as { name?: string })?.name !== "RenderingCancelledException") {
          console.error(`PDF page ${pageNumber} render failed`, renderError);
          if (!cancelled) setError(true);
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, zoom]);

  return (
    <figure className="solve-pdf-page">
      {error ? <div>このページを描画できませんでした。</div> : <canvas ref={canvasRef} aria-label={`PDF ${pageNumber}ページ`} />}
      <figcaption>{pageNumber}</figcaption>
    </figure>
  );
}

type DrawingCanvasHandle = { undo: () => void; clear: () => void };

function isStrokeArray(value: unknown): value is Stroke[] {
  return Array.isArray(value) && value.every((stroke) => {
    if (!stroke || typeof stroke !== "object") return false;
    const candidate = stroke as Partial<Stroke>;
    return (candidate.tool === "pen" || candidate.tool === "eraser")
      && typeof candidate.width === "number"
      && Array.isArray(candidate.points);
  });
}

const DrawingCanvas = React.forwardRef<DrawingCanvasHandle, {
  problemId: string;
  tool: DrawTool;
  eraserMode: EraserMode;
  width: number;
  onSyncStatus: (status: CanvasSyncStatus) => void;
}>(
  function DrawingCanvas({ problemId, tool, eraserMode, width, onSyncStatus }, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const undoStackRef = useRef<Stroke[][]>([]);
    const activeStrokeRef = useRef<Stroke | null>(null);
    const objectEraserOriginalRef = useRef<Stroke[] | null>(null);
    const objectEraserChangedRef = useRef(false);
    const activePointerIdRef = useRef<number | null>(null);
    const panRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
    const loadedRef = useRef(false);
    const localSaveTimerRef = useRef<number | null>(null);
    const saveTimerRef = useRef<number | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const saveVersionRef = useRef(0);
    const storageKey = `graduate-answer-canvas:${problemId}`;
    const [, forceRender] = useState(0);

    function renderAll() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.floor(rect.width * scale));
      const nextHeight = Math.max(1, Math.floor(rect.height * scale));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      for (const stroke of strokesRef.current) drawStroke(context, stroke, rect.width, rect.height);
    }

    function saveRemote(strokes: Stroke[]) {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      onSyncStatus("saving");
      saveTimerRef.current = window.setTimeout(async () => {
        const version = saveVersionRef.current + 1;
        saveVersionRef.current = version;
        saveQueueRef.current = saveQueueRef.current.then(async () => {
          try {
            await api.saveProblemWorkspace(problemId, strokes);
            if (version === saveVersionRef.current) onSyncStatus("saved");
          } catch (error) {
            console.warn("Canvas server save failed", error);
            if (version === saveVersionRef.current) onSyncStatus("offline");
          }
        });
        await saveQueueRef.current;
      }, 500);
    }

    function persistNow() {
      const updatedAt = new Date().toISOString();
      const strokes = [...strokesRef.current];
      try {
        localStorage.setItem(storageKey, JSON.stringify({ strokes, updatedAt }));
      } catch (error) {
        console.warn("Canvas autosave failed", error);
      }
      saveRemote(strokes);
    }

    function schedulePersist() {
      onSyncStatus("saving");
      if (localSaveTimerRef.current !== null) window.clearTimeout(localSaveTimerRef.current);
      // JSON serialization and localStorage are synchronous. Keep them out of the
      // pointer-up path so a quick next Pencil stroke can start immediately.
      localSaveTimerRef.current = window.setTimeout(() => {
        localSaveTimerRef.current = null;
        if (activePointerIdRef.current !== null) {
          schedulePersist();
          return;
        }
        persistNow();
      }, 240);
    }

    useEffect(() => {
      let cancelled = false;
      let localStrokes: Stroke[] = [];
      let localUpdatedAt = "";
      try {
        const raw = localStorage.getItem(storageKey);
        const saved = raw ? JSON.parse(raw) as unknown : null;
        if (isStrokeArray(saved)) {
          localStrokes = saved;
        } else if (saved && typeof saved === "object") {
          const record = saved as { strokes?: unknown; updatedAt?: unknown };
          if (isStrokeArray(record.strokes)) localStrokes = record.strokes;
          if (typeof record.updatedAt === "string") localUpdatedAt = record.updatedAt;
        }
      } catch {
        localStrokes = [];
      }

      async function loadWorkspace() {
        onSyncStatus("loading");
        try {
          const response = await api.problemWorkspace(problemId);
          if (cancelled) return;
          const remote = response.workspace;
          if (remote && isStrokeArray(remote.strokes) && remote.updated_at >= localUpdatedAt) {
            strokesRef.current = remote.strokes;
            undoStackRef.current = [];
            localStorage.setItem(storageKey, JSON.stringify({ strokes: remote.strokes, updatedAt: remote.updated_at }));
            onSyncStatus("saved");
          } else {
            strokesRef.current = localStrokes;
            undoStackRef.current = [];
            if (localStrokes.length > 0) saveRemote(localStrokes);
            else onSyncStatus("saved");
          }
        } catch (error) {
          console.warn("Canvas server load failed", error);
          if (!cancelled) {
            strokesRef.current = localStrokes;
            undoStackRef.current = [];
            onSyncStatus("offline");
          }
        } finally {
          if (!cancelled) {
            loadedRef.current = true;
            forceRender((current) => current + 1);
          }
        }
      }

      void loadWorkspace();
      return () => {
        cancelled = true;
        if (localSaveTimerRef.current !== null) {
          window.clearTimeout(localSaveTimerRef.current);
          persistNow();
        }
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      };
    }, [storageKey]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      const preventBrowserGesture = (event: Event) => event.preventDefault();
      canvas.addEventListener("selectstart", preventBrowserGesture);
      canvas.addEventListener("dragstart", preventBrowserGesture);
      canvas.addEventListener("contextmenu", preventBrowserGesture);
      const observer = new ResizeObserver(renderAll);
      observer.observe(canvas);
      renderAll();
      return () => {
        canvas.removeEventListener("selectstart", preventBrowserGesture);
        canvas.removeEventListener("dragstart", preventBrowserGesture);
        canvas.removeEventListener("contextmenu", preventBrowserGesture);
        observer.disconnect();
      };
    }, []);

    React.useImperativeHandle(forwardedRef, () => ({
      undo() {
        const previous = undoStackRef.current.pop();
        strokesRef.current = previous ?? strokesRef.current.slice(0, -1);
        schedulePersist();
        renderAll();
      },
      clear() {
        if (strokesRef.current.length === 0 || window.confirm("キャンバスの書き込みをすべて消しますか？")) {
          undoStackRef.current.push(strokesRef.current);
          strokesRef.current = [];
          schedulePersist();
          renderAll();
        }
      },
    }));

    function normalizedPoint(event: PointerEvent, fallbackPressure = 0.5): Point {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, pressure: fallbackPressure };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
        pressure: event.pressure > 0 ? event.pressure : fallbackPressure,
      };
    }

    function appendPointerSamples(event: PointerEvent, stroke: Stroke) {
      const samples = typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
      const events = samples.length > 0 ? samples : [event];
      const startIndex = stroke.points.length;
      for (const sample of events) {
        const previous = stroke.points.at(-1);
        const point = normalizedPoint(sample, previous?.pressure ?? 0.5);
        if (previous && point.x === previous.x && point.y === previous.y) continue;
        stroke.points.push(point);
      }
      if (stroke.points.length === startIndex) return;

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      drawStroke(context, stroke, rect.width, rect.height, Math.max(0, startIndex - 1));
    }

    function eraseObjectsAt(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      const events = samples.length > 0 ? samples : [event];
      let nextStrokes = strokesRef.current;
      for (const sample of events) {
        const point = normalizedPoint(sample);
        nextStrokes = nextStrokes.filter((stroke) => !strokeIntersectsPoint(stroke, point, rect.width, rect.height, 14));
      }
      if (nextStrokes.length === strokesRef.current.length) return;
      strokesRef.current = nextStrokes;
      objectEraserChangedRef.current = true;
      renderAll();
    }

    function toolForPointer(event: React.PointerEvent<HTMLCanvasElement>) {
      if (event.pointerType !== "pen") return tool;
      if (event.button === 5 || (event.buttons & 32) !== 0) return "eraser";
      if (event.button === 2 || (event.buttons & 2) !== 0) return tool === "pen" ? "eraser" : "pen";
      return tool;
    }

    function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
      if (!loadedRef.current) return;

      if (event.pointerType === "touch") {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
        return;
      }

      if (event.pointerType !== "pen" && event.pointerType !== "mouse") return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Safari can reject capture during a rapid Pencil re-contact. The active
        // pointer id still keeps this stroke isolated from touch input.
      }
      activePointerIdRef.current = event.pointerId;
      const nextTool = toolForPointer(event);
      const useObjectEraser = nextTool === "eraser" && tool === "eraser" && eraserMode === "object";
      if (useObjectEraser) {
        objectEraserOriginalRef.current = strokesRef.current;
        objectEraserChangedRef.current = false;
        activeStrokeRef.current = null;
        eraseObjectsAt(event.nativeEvent);
        return;
      }
      activeStrokeRef.current = {
        tool: nextTool,
        width: nextTool === "eraser" ? Math.max(18, width * 5) : width,
        points: [],
      };
      appendPointerSamples(event.nativeEvent, activeStrokeRef.current);
    }

    function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
      const pan = panRef.current;
      if (pan?.pointerId === event.pointerId) {
        event.preventDefault();
        const surface = event.currentTarget.parentElement;
        if (surface) {
          surface.scrollLeft -= event.clientX - pan.clientX;
          surface.scrollTop -= event.clientY - pan.clientY;
        }
        pan.clientX = event.clientX;
        pan.clientY = event.clientY;
        return;
      }

      const stroke = activeStrokeRef.current;
      if (activePointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      if (objectEraserOriginalRef.current) {
        eraseObjectsAt(event.nativeEvent);
        return;
      }
      if (!stroke) return;
      appendPointerSamples(event.nativeEvent, stroke);
    }

    function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
      if (panRef.current?.pointerId === event.pointerId) {
        panRef.current = null;
        return;
      }

      if (activePointerIdRef.current !== event.pointerId) return;
      const stroke = activeStrokeRef.current;
      if (objectEraserOriginalRef.current) {
        if (objectEraserChangedRef.current) {
          undoStackRef.current.push(objectEraserOriginalRef.current);
          schedulePersist();
        }
        objectEraserOriginalRef.current = null;
        objectEraserChangedRef.current = false;
      } else if (stroke) {
        if (event.type !== "pointercancel") appendPointerSamples(event.nativeEvent, stroke);
        undoStackRef.current.push(strokesRef.current);
        strokesRef.current = [...strokesRef.current, stroke];
        schedulePersist();
      }
      activeStrokeRef.current = null;
      activePointerIdRef.current = null;
    }

    return (
      <div className="drawing-surface">
        <span className="drawing-input-hint" aria-hidden="true">Pencilで描画・指で移動</span>
        <canvas
          ref={canvasRef}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          draggable={false}
          aria-label="解答を書き込むキャンバス。Apple Pencilで描画し、指でキャンバスを移動できます"
        />
      </div>
    );
  },
);

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, fromIndex = 0) {
  if (stroke.points.length === 0) return;
  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = "#15201f";
  context.fillStyle = "#15201f";
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.points.length === 1 && fromIndex === 0) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x * width, point.y * height, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (let index = Math.max(1, fromIndex + 1); index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const point = stroke.points[index];
    context.lineWidth = stroke.width * (stroke.tool === "eraser" ? 1 : 0.75 + point.pressure * 0.5);
    context.beginPath();
    context.moveTo(previous.x * width, previous.y * height);
    context.lineTo(point.x * width, point.y * height);
    context.stroke();
  }
  context.restore();
}
