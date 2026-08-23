import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ClipboardCheck, FilePenLine, Plus, RefreshCw, Search, Send, ShieldCheck, X } from "lucide-react";
import { api } from "./api";
import type { DiagnosticBlueprintInput, DiagnosticBlueprintQueue, User } from "./types";

type Blueprint = DiagnosticBlueprintQueue["items"][number]["blueprints"][number];
type QueueState = "all" | DiagnosticBlueprintQueue["items"][number]["state"];

const STATE_LABELS: Record<Exclude<QueueState, "all">, string> = {
  not_started: "未着手",
  drafting: "仕様作成中",
  in_review: "審査中",
  specification_ready: "制作準備済み",
};

const COGNITIVE_LABELS: Record<DiagnosticBlueprintInput["cognitive_demand"], string> = {
  concept_application: "概念適用",
  multi_step_reasoning: "多段推論",
  transfer: "転移・応用",
};

const ANSWER_LABELS: Record<DiagnosticBlueprintInput["answer_format"], string> = {
  multiple_choice: "選択式",
  numeric: "数値",
  short_text: "短答",
  proof: "証明",
  derivation: "導出",
  programming: "プログラミング",
  essay: "論述",
  mixed: "複合",
};

function BlueprintEditor({ blueprint, user, onChanged }: { blueprint: Blueprint; user: User; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(blueprint.title);
  const [objective, setObjective] = useState(blueprint.assessment_objective);
  const [evidence, setEvidence] = useState(blueprint.evidence_expectation);
  const [cognitiveDemand, setCognitiveDemand] = useState(blueprint.cognitive_demand);
  const [answerFormat, setAnswerFormat] = useState(blueprint.answer_format);
  const [difficulty, setDifficulty] = useState(blueprint.difficulty);
  const [minutes, setMinutes] = useState(blueprint.estimated_minutes);
  const [rubricText, setRubricText] = useState(blueprint.rubric.map((criterion) => `${criterion.label}|${criterion.weight}`).join("\n"));
  const [misconceptionsText, setMisconceptionsText] = useState(blueprint.misconception_targets.join("\n"));
  const [reviewChecks, setReviewChecks] = useState({ objective_matches_node: false, rubric_scores_evidence: false, originality_confirmed: false });
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = blueprint.status === "draft" || blueprint.status === "rejected";
  const canReview = (user.role === "reviewer" || user.role === "admin") && blueprint.submitted_by !== user.id;

  function input(): DiagnosticBlueprintInput {
    return {
      title: title.trim(),
      assessment_objective: objective.trim(),
      evidence_expectation: evidence.trim(),
      cognitive_demand: cognitiveDemand,
      answer_format: answerFormat,
      difficulty,
      estimated_minutes: minutes,
      rubric: rubricText.split("\n").map((line) => {
        const [label = "", weight = ""] = line.split("|");
        return { label: label.trim(), weight: Number(weight.trim()) };
      }).filter((criterion) => criterion.label),
      misconception_targets: misconceptionsText.split("\n").map((line) => line.trim()).filter(Boolean),
      originality_policy: "original_only",
    };
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "仕様を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`diagnostic-blueprint-card ${blueprint.status}`}>
      <header>
        <div><strong>仕様 {blueprint.slot}: {blueprint.title}</strong><span>{COGNITIVE_LABELS[blueprint.cognitive_demand]}・{ANSWER_LABELS[blueprint.answer_format]}・v{blueprint.revision}</span></div>
        <span className={`diagnostic-blueprint-status ${blueprint.status}`}>{blueprint.status === "draft" ? "下書き" : blueprint.status === "candidate" ? "審査待ち" : blueprint.status === "approved" ? "承認済み" : blueprint.status === "rejected" ? "要修正" : "廃止"}</span>
      </header>
      {blueprint.review_note ? <p className="diagnostic-blueprint-review-note"><CircleAlert />レビュー: {blueprint.review_note}</p> : null}
      {error ? <p className="form-status error" role="alert">{error}</p> : null}
      {editable ? (
        <div className="diagnostic-blueprint-form">
          <label className="span-2"><span>仕様名</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
          <label className="span-2"><span>測定目的</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} maxLength={500} /></label>
          <label className="span-2"><span>観測する証拠</span><textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={3} maxLength={500} /></label>
          <label><span>認知負荷</span><select value={cognitiveDemand} onChange={(event) => setCognitiveDemand(event.target.value as DiagnosticBlueprintInput["cognitive_demand"])}>{Object.entries(COGNITIVE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>解答形式</span><select value={answerFormat} onChange={(event) => setAnswerFormat(event.target.value as DiagnosticBlueprintInput["answer_format"])}>{Object.entries(ANSWER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>難度 1〜5</span><input type="number" min={1} max={5} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
          <label><span>所要時間 5〜120分</span><input type="number" min={5} max={120} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
          <label className="span-2"><span>採点基準（1行に「項目|重み」、合計1.0）</span><textarea value={rubricText} onChange={(event) => setRubricText(event.target.value)} rows={4} /></label>
          <label className="span-2"><span>想定誤答（1行1件）</span><textarea value={misconceptionsText} onChange={(event) => setMisconceptionsText(event.target.value)} rows={3} /></label>
          <div className="diagnostic-blueprint-policy span-2"><ShieldCheck /><span>第三者の過去問本文を複製せず、オリジナル問題として制作します。</span></div>
          <div className="diagnostic-blueprint-actions span-2">
            <button onClick={() => void run(() => api.updateDiagnosticBlueprint(blueprint.id, blueprint.revision, input()))} disabled={busy}>下書きを保存</button>
            {blueprint.status === "draft" ? <button className="submit" onClick={() => { if (window.confirm("測定可能性と原創性を確認し、審査へ提出しますか？保存していない入力は反映されません。")) void run(() => api.submitDiagnosticBlueprint(blueprint.id, blueprint.revision)); }} disabled={busy}><Send />審査へ提出</button> : null}
          </div>
        </div>
      ) : (
        <div className="diagnostic-blueprint-readonly">
          <div><small>測定目的</small><p>{blueprint.assessment_objective}</p></div>
          <div><small>観測する証拠</small><p>{blueprint.evidence_expectation}</p></div>
          <dl><div><dt>難度</dt><dd>{blueprint.difficulty}/5</dd></div><div><dt>時間</dt><dd>{blueprint.estimated_minutes}分</dd></div><div><dt>原創性</dt><dd>original only</dd></div></dl>
          <div><small>採点基準</small><ul>{blueprint.rubric.map((criterion) => <li key={criterion.label}>{criterion.label} <strong>{Math.round(criterion.weight * 100)}%</strong></li>)}</ul></div>
          <div><small>想定誤答</small><ul>{blueprint.misconception_targets.map((target) => <li key={target}>{target}</li>)}</ul></div>
        </div>
      )}
      {blueprint.quality_issues.length > 0 ? <ul className="diagnostic-blueprint-issues">{blueprint.quality_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      {blueprint.status === "candidate" ? (
        <div className="diagnostic-blueprint-review">
          {canReview ? <>
            <label><input type="checkbox" checked={reviewChecks.objective_matches_node} onChange={(event) => setReviewChecks((current) => ({ ...current, objective_matches_node: event.target.checked }))} />測定目的が対象ノードと一致</label>
            <label><input type="checkbox" checked={reviewChecks.rubric_scores_evidence} onChange={(event) => setReviewChecks((current) => ({ ...current, rubric_scores_evidence: event.target.checked }))} />採点基準が観測証拠を評価</label>
            <label><input type="checkbox" checked={reviewChecks.originality_confirmed} onChange={(event) => setReviewChecks((current) => ({ ...current, originality_confirmed: event.target.checked }))} />第三者問題の複製ではない</label>
            <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="却下時は10文字以上の修正理由を入力" maxLength={500} rows={2} />
            <div><button onClick={() => void run(() => api.reviewDiagnosticBlueprint(blueprint.id, blueprint.revision, "approved", reviewNote, reviewChecks))} disabled={busy || !Object.values(reviewChecks).every(Boolean)}><CheckCircle2 />承認</button><button className="reject" onClick={() => void run(() => api.reviewDiagnosticBlueprint(blueprint.id, blueprint.revision, "rejected", reviewNote, reviewChecks))} disabled={busy || reviewNote.trim().length < 10}><X />差し戻す</button></div>
          </> : <p><ShieldCheck />提出者とは別のreviewer / adminによる審査が必要です。</p>}
        </div>
      ) : null}
    </article>
  );
}

export function DiagnosticBlueprintAdmin({ user }: { user: User }) {
  const [queue, setQueue] = useState<DiagnosticBlueprintQueue | null>(null);
  const [filter, setFilter] = useState<QueueState>("not_started");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.diagnosticBlueprints();
      if (sequence === requestSequence.current) setQueue(response.blueprint_queue);
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "診断仕様を読み込めませんでした。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, []);

  useEffect(() => { setShown(20); }, [filter, query]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return (queue?.items ?? []).filter((item) => (filter === "all" || (filter === "specification_ready" ? item.specification_ready : item.state === filter))
      && (!normalized || `${item.node_label} ${item.topic} ${item.blueprints.map((blueprint) => blueprint.title).join(" ")}`.toLocaleLowerCase("ja").includes(normalized)));
  }, [filter, query, queue]);

  async function create(graphNodeId: string, slot: number) {
    setBusyNode(graphNodeId);
    setError("");
    try {
      await api.createDiagnosticBlueprint(graphNodeId, slot);
      setFilter("drafting");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "仕様下書きを作成できませんでした。");
    } finally {
      setBusyNode(null);
    }
  }

  return (
    <section className="panel diagnostic-blueprint-panel">
      <header className="diagnostic-blueprint-header"><div><span>ASSESSMENT DESIGN QA</span><h2>オリジナル診断問題の仕様</h2><p>問題制作前に、何をどう測り、どう採点するかを二重レビューします。</p></div><button onClick={() => void load()} disabled={loading}><RefreshCw />{loading ? "更新中" : "再集計"}</button></header>
      {queue ? <div className="diagnostic-blueprint-kpis">
        <button className={filter === "not_started" ? "active" : ""} onClick={() => setFilter("not_started")}><Plus /><span>未着手</span><strong>{queue.summary.not_started_nodes}</strong></button>
        <button className={filter === "drafting" ? "active" : ""} onClick={() => setFilter("drafting")}><FilePenLine /><span>仕様作成中</span><strong>{queue.summary.drafting_nodes}</strong></button>
        <button className={filter === "in_review" ? "active" : ""} onClick={() => setFilter("in_review")}><ClipboardCheck /><span>審査中仕様</span><strong>{queue.summary.pending_blueprints}</strong></button>
        <button className={filter === "specification_ready" ? "active" : ""} onClick={() => setFilter("specification_ready")}><CheckCircle2 /><span>制作準備済み</span><strong>{queue.summary.specification_ready_nodes}</strong></button>
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><ShieldCheck /><span>承認済み仕様</span><strong>{queue.summary.approved_blueprints}</strong></button>
      </div> : null}
      {error ? <div className="form-status error" role="alert">{error}</div> : null}
      <div className="diagnostic-blueprint-toolbar"><label><Search /><span className="sr-only">仕様を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ノード・科目・仕様名で検索" /></label><span>{visibleItems.length}ノード</span></div>
      <div className="diagnostic-blueprint-list" aria-busy={loading}>
        {!loading && visibleItems.length === 0 ? <p className="diagnostic-blueprint-empty">条件に一致する仕様はありません。</p> : null}
        {visibleItems.slice(0, shown).map((item, index) => {
          const occupiedSlots = new Set(item.blueprints.map((blueprint) => blueprint.slot));
          return <details key={item.graph_node_id} open={index < 2 && item.state !== "not_started"} className={`diagnostic-blueprint-node ${item.state}`}>
            <summary><span><strong>{item.node_label}</strong><small>{item.topic}・直接問題 {item.current_direct_count}/2</small></span><span>{STATE_LABELS[item.state]}</span><span>問題不足 {item.problem_deficit}問</span></summary>
            <div className="diagnostic-blueprint-node-body">
              <div className="diagnostic-blueprint-create-actions">{([1, 2, 3] as const).filter((slot) => !occupiedSlots.has(slot)).map((slot) => <button key={slot} onClick={() => void create(item.graph_node_id, slot)} disabled={busyNode === item.graph_node_id}><Plus />仕様{slot}の下書きを作成</button>)}</div>
              {item.blueprints.map((blueprint) => <BlueprintEditor key={`${blueprint.id}:${blueprint.revision}`} blueprint={blueprint} user={user} onChanged={load} />)}
              {item.specification_ready ? <p className="diagnostic-blueprint-ready"><CheckCircle2 />異なる認知負荷の承認済み仕様を2件確保しました。これは問題制作の準備完了であり、診断問題の充足ではありません。</p> : null}
            </div>
          </details>;
        })}
      </div>
      {visibleItems.length > shown ? <button className="diagnostic-blueprint-more" onClick={() => setShown((current) => current + 20)}>さらに{Math.min(20, visibleItems.length - shown)}件表示</button> : null}
      <footer>仕様承認だけでは問題候補や充足率へ加算しません。問題本文・模範解答・採点例を制作して別途レビューした後に、診断リンクへ進みます。</footer>
    </section>
  );
}
