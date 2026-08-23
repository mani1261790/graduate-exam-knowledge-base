import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ClipboardList, ExternalLink, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { api } from "./api";
import type { DiagnosticRemediationQueue, User } from "./types";

const STATE_LABELS: Record<DiagnosticRemediationQueue["items"][number]["state"], string> = {
  ready: "診断準備済み",
  review_candidates: "既存問題をレビュー可能",
  new_content_required: "新しい問題が必要",
};

const NODE_TYPE_LABELS = {
  FOUNDATIONAL: "前提",
  BASIC: "基礎",
  CORE: "中核",
  APPLICATION: "応用",
} as const;

const ANSWER_FORMAT_LABELS: Record<string, string> = {
  multiple_choice: "選択式",
  numeric: "数値",
  short_text: "短答",
  proof: "証明",
  derivation: "導出",
  programming: "プログラミング",
  essay: "論述",
  mixed: "複合",
};

type QueueState = "all" | DiagnosticRemediationQueue["items"][number]["state"];

export function DiagnosticContentAdmin({ user, onChanged }: { user: User; onChanged: () => Promise<void> }) {
  const [queue, setQueue] = useState<DiagnosticRemediationQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<QueueState>("review_candidates");
  const [query, setQuery] = useState("");
  const requestSequence = useRef(0);
  const canReview = user.role === "reviewer" || user.role === "admin";

  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.diagnosticRemediation();
      if (sequence === requestSequence.current) setQueue(response.remediation);
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : "診断問題の整備キューを読み込めませんでした。");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, []);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ja");
    return (queue?.items ?? []).filter((item) => (filter === "all" || item.state === filter)
      && (!normalizedQuery || `${item.node_label} ${item.topic} ${item.candidates.map((candidate) => candidate.problem_label).join(" ")}`
        .toLocaleLowerCase("ja").includes(normalizedQuery)));
  }, [filter, query, queue]);

  async function propose(graphNodeId: string, problemId: string) {
    setBusyId(problemId);
    setError("");
    setMessage("");
    try {
      const response = await api.proposeDiagnosticLink(graphNodeId, problemId);
      setMessage(response.created ? "診断リンクを確認待ちとして提出しました。" : "既存の診断リンクを表示しました。");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "診断リンクを提出できませんでした。");
    } finally {
      setBusyId(null);
    }
  }

  async function review(linkId: string, status: "approved" | "rejected") {
    setBusyId(linkId);
    setError("");
    setMessage("");
    try {
      await api.reviewDiagnosticLink(linkId, status);
      setMessage(status === "approved" ? "診断リンクを承認しました。次回の学習計画から利用されます。" : "診断リンクを却下しました。");
      await Promise.all([load(), onChanged()]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "診断リンクをレビューできませんでした。");
    } finally {
      setBusyId(null);
    }
  }

  async function resubmit(linkId: string) {
    setBusyId(linkId);
    setError("");
    setMessage("");
    try {
      await api.resubmitDiagnosticLink(linkId);
      setMessage("現在の問題・公開元・概念エッジを再検証し、確認待ちへ戻しました。");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "診断リンクを再提出できませんでした。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel diagnostic-remediation-panel">
      <header className="diagnostic-remediation-header">
        <div><span>DIAGNOSTIC CONTENT OPS</span><h2>診断問題の整備キュー</h2><p>概念が重なる既存問題を候補化し、承認後だけ学習計画へ反映します。</p></div>
        <button onClick={() => void load()} disabled={loading}><RefreshCw />{loading ? "更新中" : "再集計"}</button>
      </header>

      {queue ? (
        <div className="diagnostic-remediation-kpis" aria-label="診断問題整備の状態">
          <button className={filter === "review_candidates" ? "active" : ""} onClick={() => setFilter("review_candidates")}><ClipboardList /><span>レビュー可能</span><strong>{queue.summary.reviewable_nodes}</strong><small>既存問題あり</small></button>
          <button className={filter === "new_content_required" ? "active" : ""} onClick={() => setFilter("new_content_required")}><CircleAlert /><span>新規作成が必要</span><strong>{queue.summary.new_content_nodes}</strong><small>候補問題なし</small></button>
          <button className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}><CheckCircle2 /><span>準備済み</span><strong>{queue.summary.ready_nodes}</strong><small>直接問題2問以上</small></button>
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><ShieldCheck /><span>承認待ち</span><strong>{queue.summary.pending_reviews}</strong><small>明示リンク {queue.summary.approved_explicit_links}</small></button>
        </div>
      ) : null}

      {message ? <div className="form-status success" role="status">{message}</div> : null}
      {error ? <div className="form-status error" role="alert">{error}</div> : null}

      <div className="diagnostic-remediation-toolbar">
        <label><Search /><span className="sr-only">ノードまたは問題を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ノード・科目・問題名で検索" /></label>
        <span>{visibleItems.length}ノード</span>
      </div>

      <div className="diagnostic-remediation-list" aria-busy={loading}>
        {!loading && visibleItems.length === 0 ? <p className="diagnostic-remediation-empty">条件に一致する整備項目はありません。</p> : null}
        {visibleItems.map((item, index) => (
          <details key={item.graph_node_id} open={index < 3 && filter === "review_candidates"} className={`diagnostic-remediation-item ${item.state}`}>
            <summary>
              <span><strong>{item.node_label}</strong><small>{item.topic}・{NODE_TYPE_LABELS[item.node_type]}</small></span>
              <span className="diagnostic-remediation-state">{STATE_LABELS[item.state]}</span>
              <span><strong>{item.current_direct_count} / {item.target_direct_count}問</strong><small>不足 {item.deficit}問</small></span>
            </summary>
            {item.candidates.length === 0 ? (
              <div className="diagnostic-remediation-spec"><CircleAlert /><div><strong>流用できるレビュー済み問題がありません</strong><p>「{item.node_label}」を直接測定する問題を最低{item.deficit}問用意し、公開元・解答形式・承認済みtests概念を確認してください。</p></div></div>
            ) : (
              <div className="diagnostic-remediation-candidates">
                {item.candidates.map((candidate) => (
                  <article key={candidate.problem_id}>
                    <div className="diagnostic-remediation-candidate-copy">
                      <header><strong>{candidate.problem_label}</strong>{candidate.label_match ? <span className="label-match">名称ヒントあり</span> : <span>内容確認必須</span>}</header>
                      <p>{candidate.university}・{candidate.exam_year}年度 / {ANSWER_FORMAT_LABELS[candidate.answer_format] ?? candidate.answer_format}・{candidate.estimated_minutes}分</p>
                      <blockquote>{candidate.statement_preview || "問題文はPDFで確認してください。"}</blockquote>
                      <small>重複する承認済みtests概念: {candidate.concept_names}{candidate.link?.rationale ? ` / ${candidate.link.rationale}` : ""}</small>
                      <a href={candidate.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink />公式PDFを確認{candidate.page_start ? `（p.${candidate.page_start}${candidate.page_end && candidate.page_end !== candidate.page_start ? `–${candidate.page_end}` : ""}）` : ""}</a>
                    </div>
                    <div className="diagnostic-remediation-actions">
                      {!candidate.link ? <button onClick={() => void propose(item.graph_node_id, candidate.problem_id)} disabled={busyId === candidate.problem_id}>{busyId === candidate.problem_id ? "提出中" : "候補として提出"}</button> : null}
                      {candidate.link?.status === "candidate" && canReview ? <><button onClick={() => { if (window.confirm(`「${candidate.problem_label}」が「${item.node_label}」を直接測定することを、問題文と公式PDFで確認しましたか？`)) void review(candidate.link!.id, "approved"); }} disabled={busyId === candidate.link.id}><CheckCircle2 />確認して承認</button><button className="reject" onClick={() => void review(candidate.link!.id, "rejected")} disabled={busyId === candidate.link.id}><X />却下</button></> : null}
                      {candidate.link?.status === "candidate" && !canReview ? <span className="pending">レビュー待ち</span> : null}
                      {candidate.link?.status === "approved" ? <span className="approved"><CheckCircle2 />承認済み</span> : null}
                      {candidate.link?.status === "rejected" ? <><span className="rejected"><X />却下済み</span><button className="resubmit" onClick={() => void resubmit(candidate.link!.id)} disabled={busyId === candidate.link.id}>根拠を再検証して再提出</button></> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </details>
        ))}
      </div>
      <footer>候補提出だけでは推薦を変えません。レビュー時に問題・公開元・概念エッジを再検証し、承認された明示リンクだけを利用します。</footer>
    </section>
  );
}
