import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, MessageCircle, Pause, Play, Save, Send, X } from "lucide-react";
import { api } from "./api";
import type { ProblemChatMessage, ProblemDetail } from "./types";
import "./solve-workspace.css";

const RESULT_LABELS: Record<string, string> = {
  correct: "解けた",
  partial: "途中まで",
  wrong: "解けなかった",
  skipped: "見送った",
};

function formatStopwatch(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function pageRange(problem: ProblemDetail) {
  const start = Math.max(1, problem.page_start ?? 1);
  const end = Math.max(start, problem.page_end ?? start);
  return { start, end };
}

function sourcePdfUrl(problem: ProblemDetail) {
  if (!problem.source_url) return "";
  const [base] = problem.source_url.split("#");
  return `${base}#page=${Math.max(1, problem.page_start ?? 1)}&view=FitH`;
}

export function SolveWorkspacePage() {
  const problemId = new URLSearchParams(window.location.search).get("id") ?? "";
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!problemId) {
      setError("解く問題が指定されていません。");
      return undefined;
    }
    void api.problem(problemId)
      .then((response) => { if (!cancelled) setProblem(response.problem); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "問題を読み込めませんでした。"); });
    return () => { cancelled = true; };
  }, [problemId]);

  if (error) return <main className="solve-loading"><strong>問題を開けませんでした</strong><p>{error}</p><a href="/">演習帳へ戻る</a></main>;
  if (!problem) return <main className="solve-loading">解答画面を準備しています...</main>;
  return <SolveWorkspace key={problem.id} problem={problem} />;
}

function SolveWorkspace({ problem }: { problem: ProblemDetail }) {
  const startedAt = useRef(new Date().toISOString());
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const [finishOpen, setFinishOpen] = useState(false);
  const [result, setResult] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [note, setNote] = useState("");
  const [usedHint, setUsedHint] = useState(false);
  const [lookedSolution, setLookedSolution] = useState(false);
  const [confidence, setConfidence] = useState("3");
  const [weakConceptIds, setWeakConceptIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ProblemChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "sending">("idle");
  const [chatError, setChatError] = useState<string | null>(null);
  const pages = pageRange(problem);
  const pdfUrl = sourcePdfUrl(problem);

  useEffect(() => {
    if (!timerRunning) return undefined;
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    if (chatOpen) window.setTimeout(() => chatInputRef.current?.focus(), 0);
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
    if (!result) return setSaveError("結果を選んでください。");
    const parsedMinutes = Number(minutes);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) return setSaveError("所要時間を0以上の数字で入力してください。");
    setSaving(true);
    setSaveError(null);
    try {
      await api.createAttempt({
        problem_id: problem.id,
        started_at: startedAt.current,
        result,
        time_spent_minutes: Math.round(parsedMinutes),
        note,
        used_hint: usedHint,
        looked_solution: lookedSolution,
        self_confidence: Number(confidence),
        mistakes: weakConceptIds.map((conceptId) => ({ concept_id: conceptId, mistake_type: "concept_missing" })),
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
      setChatError(error instanceof Error ? error.message : "回答を生成できませんでした。");
    } finally {
      setChatStatus("idle");
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
        <div className="solve-actions">
          {pdfUrl ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />公式PDFを別タブで開く</a> : null}
          <div className="timer-tool">
            <button onClick={() => setTimerRunning((current) => !current)} aria-label={timerRunning ? "タイマーを一時停止" : "タイマーを再開"}>
              {timerRunning ? <Pause /> : <Play />}
            </button>
            <time>{formatStopwatch(elapsedSeconds)}</time>
          </div>
          <button className="finish-button" onClick={openFinish}><Save />終了して記録</button>
        </div>
      </header>

      <section className="solve-pdf-pane" aria-label="問題PDF">
        <div className="pane-label">
          <div><span>公式PDF全体</span><small>対象: {pages.start === pages.end ? `${pages.start}ページ` : `${pages.start}〜${pages.end}ページ`}</small></div>
          <p>問題ごとの切り出しではありません。PDF内の対象ページを確認してください。</p>
        </div>
        {!pdfUrl ? (
          <ExternalPdfFallback message="この問題には公開元PDFが登録されていません。" />
        ) : problem.pdf_display_mode === "embed" ? (
          <div className="external-pdf-shell">
            <iframe src={pdfUrl} title={`${problem.problem_label} 公式PDF`} />
            <div className="iframe-help">表示されない場合は、上部の「公式PDFを別タブで開く」を使用してください。</div>
          </div>
        ) : (
          <ExternalPdfFallback message="公開元の設定により、このPDFはサイト内に表示できません。" url={pdfUrl} pages={pages} />
        )}
      </section>

      <button className="problem-chat-launcher" onClick={() => setChatOpen(true)} aria-label="AIチャットを開く" title="AIチャット"><MessageCircle /></button>
      {chatOpen ? (
        <aside className="problem-chat-drawer" aria-label="問題AIチャット">
          <div className="problem-chat-head"><div><span>AIチャット</span><strong>{problem.problem_label}</strong></div><button onClick={() => setChatOpen(false)} aria-label="閉じる"><X /></button></div>
          <div className="problem-chat-context"><span>{problem.university} {problem.exam_year}</span><small>{pages.start === pages.end ? `${pages.start}ページ` : `${pages.start}〜${pages.end}ページ`}</small></div>
          <div className="problem-chat-messages" aria-live="polite">
            {chatMessages.length === 0 ? <div className="problem-chat-empty"><MessageCircle /><p>どこで詰まっていますか？</p></div> : chatMessages.map((message, index) => <div key={`${message.role}-${index}`} className={`problem-chat-message ${message.role}`}><p>{message.content}</p></div>)}
            {chatStatus === "sending" ? <div className="problem-chat-message assistant pending"><Loader2 /><p>考えています...</p></div> : null}
          </div>
          {chatError ? <p className="problem-chat-error">{chatError}</p> : null}
          <form className="problem-chat-form" onSubmit={(event) => { event.preventDefault(); void sendChatMessage(); }}>
            <label htmlFor="problem-chat-input" className="sr-only">質問</label>
            <textarea ref={chatInputRef} id="problem-chat-input" value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChatMessage(); } }} rows={3} maxLength={1200} placeholder="この問題について質問" disabled={chatStatus === "sending"} />
            <button type="submit" disabled={!chatInput.trim() || chatStatus === "sending"} aria-label="送信">{chatStatus === "sending" ? <Loader2 className="chat-spinner" /> : <Send />}</button>
          </form>
        </aside>
      ) : null}

      {finishOpen ? (
        <div className="finish-backdrop" role="dialog" aria-modal="true" aria-label="学習記録">
          <section className="finish-dialog">
            <div className="finish-head"><div><span>学習記録</span><h1>{saved ? "保存しました" : "結果を記録する"}</h1></div>{!saved ? <button onClick={closeFinish} aria-label="閉じる"><X /></button> : null}</div>
            {saved ? <div className="finish-success"><Check /><p>所要時間と結果を、学習計画と復習時期に反映しました。</p><a href="/?view=study-plan">学習計画へ戻る</a></div> : (
              <>
                <fieldset className="finish-section result-section"><legend>今回の結果 <span>必須</span></legend><div className="result-options">{Object.entries(RESULT_LABELS).map(([value, label]) => <button type="button" key={value} className={result === value ? "active" : ""} aria-pressed={result === value} onClick={() => setResult(value)}>{label}</button>)}</div></fieldset>
                <div className="finish-row">
                  <label className="finish-field"><span>所要時間（分）</span><input value={minutes} onChange={(event) => setMinutes(event.target.value)} inputMode="numeric" /></label>
                  <fieldset className="finish-section confidence-section"><legend>自信度</legend><div className="confidence-options">{[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name="confidence" value={value} checked={confidence === String(value)} onChange={(event) => setConfidence(event.target.value)} /><span>{value}</span></label>)}</div><small>1: 自信なし〜5: 自信あり</small></fieldset>
                </div>
                <fieldset className="finish-section support-section"><legend>使ったサポート <span>任意</span></legend><div><label><input type="checkbox" checked={usedHint} onChange={(event) => setUsedHint(event.target.checked)} /><span>ヒントを使った</span></label><label><input type="checkbox" checked={lookedSolution} onChange={(event) => setLookedSolution(event.target.checked)} /><span>解答・解説を見た</span></label></div><small>復習間隔の計算に反映します。</small></fieldset>
                {problem.concepts.length > 0 ? <fieldset className="finish-section weak-concepts"><legend>つまずいた分野 <span>任意・複数可</span></legend><div>{problem.concepts.map((concept) => <label key={concept.id}><input type="checkbox" checked={weakConceptIds.includes(concept.id)} onChange={(event) => setWeakConceptIds((current) => event.target.checked ? [...current, concept.id] : current.filter((id) => id !== concept.id))} /><span>{concept.name_ja}</span></label>)}</div><small>選んだ分野を次回の復習で優先します。</small></fieldset> : null}
                <label className="finish-field"><span>復習メモ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="詰まったところ、次に確認すること" /></label>
                {saveError ? <p className="finish-error" role="alert">{saveError}</p> : null}
                <div className="finish-actions"><button className="secondary" onClick={closeFinish}>解答に戻る</button><button onClick={() => void saveAttempt()} disabled={saving}>{saving ? "保存中..." : "学習記録を保存"}</button></div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ExternalPdfFallback({ message, url, pages }: { message: string; url?: string; pages?: { start: number; end: number } }) {
  return (
    <div className="solve-pdf-fallback">
      <strong>{message}</strong>
      {pages ? <p>対象: {pages.start === pages.end ? `${pages.start}ページ` : `${pages.start}〜${pages.end}ページ`}</p> : null}
      {url ? <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink />公式PDFを別タブで開く</a> : null}
    </div>
  );
}
