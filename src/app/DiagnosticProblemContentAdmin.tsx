import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, FilePenLine, FlaskConical, Plus, RefreshCw, Search, Send, ShieldCheck, X } from "lucide-react";
import { api } from "./api";
import type {
  DiagnosticAdversarialCheck,
  DiagnosticProblemAuthoringQueue,
  DiagnosticProblemContentInput,
  DiagnosticScoringExample,
  DiagnosticVerificationCase,
  DiagnosticVerificationResult,
  DiagnosticVerificationType,
  User,
} from "./types";

type QueueItem = DiagnosticProblemAuthoringQueue["items"][number];
type Content = NonNullable<QueueItem["content"]>;
type Filter = "all" | QueueItem["state"];

const STATE_LABELS: Record<QueueItem["state"], string> = {
  not_started: "未着手",
  drafting: "問題制作中",
  in_review: "内容審査中",
  approved: "公開可能",
};

const SCORING_LABELS: Record<DiagnosticScoringExample["level"], string> = {
  full_credit: "満点答案例",
  partial_credit: "部分点答案例",
  no_credit: "誤答案例",
};

const CHECK_LABELS: Record<DiagnosticAdversarialCheck["type"], string> = {
  ambiguity: "曖昧性",
  answer_leakage: "答え漏洩",
  misconception_discrimination: "誤概念識別",
  edge_case: "境界条件",
};

const VERIFICATION_LABELS: Record<DiagnosticVerificationType, string> = {
  independent_recalculation: "独立再計算",
  boundary_case: "境界条件・反例",
  misconception_trap: "誤概念トラップ",
  format_compliance: "解答形式の適合",
};

function ContentEditor({ item, user, onChanged }: { item: QueueItem; user: User; onChanged: () => Promise<void> }) {
  const content = item.content!;
  const [problemLabel, setProblemLabel] = useState(content.problem_label);
  const [statement, setStatement] = useState(content.statement_text);
  const [answer, setAnswer] = useState(content.answer_text);
  const [explanation, setExplanation] = useState(content.explanation_text);
  const [scoringExamples, setScoringExamples] = useState(content.scoring_examples);
  const [adversarialChecks, setAdversarialChecks] = useState(content.adversarial_checks);
  const [verificationCases, setVerificationCases] = useState(content.verification_cases);
  const [verificationResults, setVerificationResults] = useState<DiagnosticVerificationResult[]>(
    content.verification_cases.map(({ type }) => ({ type, observed_result: "", passed: false })),
  );
  const [verificationNote, setVerificationNote] = useState("");
  const [originalityNote, setOriginalityNote] = useState(content.originality_note);
  const [reviewChecks, setReviewChecks] = useState({
    statement_matches_blueprint: false,
    scoring_calibrated: false,
    originality_confirmed: false,
  });
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = content.status === "draft" || content.status === "rejected";
  const canVerify = (user.role === "reviewer" || user.role === "admin")
    && content.created_by !== user.id && content.submitted_by !== user.id;
  const canApprove = canVerify && content.verification_status === "passed" && content.verified_by !== user.id;

  function input(): DiagnosticProblemContentInput {
    return {
      problem_label: problemLabel.trim(),
      statement_text: statement.trim(),
      answer_text: answer.trim(),
      explanation_text: explanation.trim(),
      scoring_examples: scoringExamples,
      adversarial_checks: adversarialChecks,
      verification_cases: verificationCases,
      originality_note: originalityNote.trim(),
    };
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "診断問題を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function updateScoringExample(index: number, patch: Partial<DiagnosticScoringExample>) {
    setScoringExamples((current) => current.map((example, itemIndex) => itemIndex === index ? { ...example, ...patch } : example));
  }

  function updateCriterionScore(exampleIndex: number, criterionIndex: number, score: number) {
    setScoringExamples((current) => current.map((example, itemIndex) => itemIndex !== exampleIndex ? example : {
      ...example,
      criterion_scores: example.criterion_scores.map((criterion, scoreIndex) => scoreIndex === criterionIndex ? { ...criterion, score } : criterion),
    }));
  }

  function updateAdversarialCheck(index: number, patch: Partial<DiagnosticAdversarialCheck>) {
    setAdversarialChecks((current) => current.map((check, itemIndex) => itemIndex === index ? { ...check, ...patch } : check));
  }

  function updateVerificationCase(index: number, patch: Partial<DiagnosticVerificationCase>) {
    setVerificationCases((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function updateVerificationResult(index: number, patch: Partial<DiagnosticVerificationResult>) {
    setVerificationResults((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return (
    <article className={`diagnostic-content-author-card ${content.status}`}>
      <header>
        <div><strong>{content.problem_label}</strong><span>内容 v{content.revision}・問題ID {content.problem_id}</span></div>
        <span>{content.status === "draft" ? "下書き" : content.status === "candidate" ? "内容審査待ち" : content.status === "approved" ? "承認・反映済み" : content.status === "rejected" ? "要修正" : "廃止"}</span>
      </header>
      {content.review_note ? <p className="diagnostic-content-author-note">レビュー: {content.review_note}</p> : null}
      {error ? <p className="form-status error" role="alert">{error}</p> : null}
      {editable ? (
        <div className="diagnostic-content-author-form">
          <label><span>問題名</span><input value={problemLabel} onChange={(event) => setProblemLabel(event.target.value)} maxLength={140} /></label>
          <label><span>問題本文</span><textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={8} maxLength={5000} /></label>
          <label><span>模範解答</span><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={6} maxLength={3000} /></label>
          <label><span>解説・検算</span><textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={8} maxLength={8000} /></label>
          <fieldset className="diagnostic-content-calibration"><legend>採点キャリブレーション</legend>
            {scoringExamples.map((example, exampleIndex) => <div key={example.level} className="diagnostic-content-score-example">
              <strong>{SCORING_LABELS[example.level]}</strong>
              <label><span>答案例</span><textarea value={example.response} onChange={(event) => updateScoringExample(exampleIndex, { response: event.target.value })} rows={3} /></label>
              <div className="diagnostic-content-criterion-grid">
                {example.criterion_scores.map((criterion, criterionIndex) => <label key={criterion.label}><span>{criterion.label}</span><input type="number" min={0} max={1} step={0.05} value={criterion.score} onChange={(event) => updateCriterionScore(exampleIndex, criterionIndex, Number(event.target.value))} /></label>)}
              </div>
              <label><span>加重得点率</span><input type="number" min={0} max={1} step={0.01} value={example.score_rate} onChange={(event) => updateScoringExample(exampleIndex, { score_rate: Number(event.target.value) })} /></label>
              <label><span>採点理由</span><textarea value={example.rationale} onChange={(event) => updateScoringExample(exampleIndex, { rationale: event.target.value })} rows={2} /></label>
            </div>)}
          </fieldset>
          <fieldset className="diagnostic-content-adversarial"><legend>問題品質の耐性チェック</legend>
            {adversarialChecks.map((check, index) => <div key={check.type}><strong>{CHECK_LABELS[check.type]}</strong><label><span>確認所見</span><textarea value={check.finding} onChange={(event) => updateAdversarialCheck(index, { finding: event.target.value })} rows={2} /></label><label><span>対応・修正</span><textarea value={check.resolution} onChange={(event) => updateAdversarialCheck(index, { resolution: event.target.value })} rows={2} /></label></div>)}
          </fieldset>
          <fieldset className="diagnostic-content-adversarial"><legend>独立検証の契約</legend>
            <p>別の担当者が、模範解答を信用せず再現できる入力・手順と期待値を固定します。</p>
            {verificationCases.map((verificationCase, index) => <div key={verificationCase.type}>
              <strong>{VERIFICATION_LABELS[verificationCase.type]}</strong>
              <label><span>検証入力・手順</span><textarea value={verificationCase.instruction} onChange={(event) => updateVerificationCase(index, { instruction: event.target.value })} rows={2} maxLength={800} /></label>
              <label><span>期待される結果</span><textarea value={verificationCase.expected_result} onChange={(event) => updateVerificationCase(index, { expected_result: event.target.value })} rows={2} maxLength={800} /></label>
              {item.blueprint.answer_format === "numeric" && (verificationCase.type === "independent_recalculation" || verificationCase.type === "boundary_case") ? <label><span>許容誤差</span><input type="number" min={0} step="any" value={verificationCase.tolerance ?? ""} onChange={(event) => updateVerificationCase(index, { tolerance: event.target.value === "" ? null : Number(event.target.value) })} /></label> : null}
            </div>)}
          </fieldset>
          <label><span>原創性メモ</span><textarea value={originalityNote} onChange={(event) => setOriginalityNote(event.target.value)} rows={3} maxLength={500} /></label>
          <div className="diagnostic-content-author-policy"><ShieldCheck /><span>外部問題のURLや本文を持ち込まず、一般概念から新規作成した問題だけを提出します。</span></div>
          <div className="diagnostic-content-author-actions">
            <button onClick={() => void run(() => api.updateDiagnosticOriginalProblem(content.id, content.revision, input()))} disabled={busy}>下書きを保存</button>
            {content.status === "draft" ? <button className="submit" onClick={() => { if (window.confirm("模範解答・採点例・原創性を確認し、内容審査へ提出しますか？保存していない入力は反映されません。")) void run(() => api.submitDiagnosticOriginalProblem(content.id, content.revision)); }} disabled={busy}><Send />内容審査へ提出</button> : null}
          </div>
        </div>
      ) : (
        <div className="diagnostic-content-author-readonly">
          <section><small>問題本文</small><p>{content.statement_text}</p></section>
          <section><small>模範解答</small><p>{content.answer_text}</p></section>
          <section><small>解説・検算</small><p>{content.explanation_text}</p></section>
          <section><small>採点例</small>{content.scoring_examples.map((example) => <div key={example.level}><strong>{SCORING_LABELS[example.level]}・{Math.round(example.score_rate * 100)}%</strong><p>{example.response}</p><p>{example.rationale}</p></div>)}</section>
          <section><small>耐性チェック</small>{content.adversarial_checks.map((check) => <p key={check.type}><strong>{CHECK_LABELS[check.type]}:</strong> {check.finding} → {check.resolution}</p>)}</section>
          <section><small>独立検証契約</small>{content.verification_cases.map((verificationCase) => <p key={verificationCase.type}><strong>{VERIFICATION_LABELS[verificationCase.type]}:</strong> {verificationCase.instruction}<br />期待値: {verificationCase.expected_result}</p>)}</section>
          <section><small>原創性</small><p>{content.originality_note}</p></section>
        </div>
      )}
      {content.quality_issues.length > 0 ? <ul className="diagnostic-content-author-issues">{content.quality_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      {content.status === "candidate" ? <div className="diagnostic-content-author-review">
        {content.verification_status !== "passed" && canVerify ? <>
          <h4>ステップ1 / 2　独立検証</h4>
          <p>問題作成者の解法をなぞらず、各契約を実行した観測結果を残してください。1件でも不合格なら自動的に差し戻します。</p>
          {verificationResults.map((result, index) => <div key={result.type} className="diagnostic-content-verification-result">
            <strong>{VERIFICATION_LABELS[result.type]}</strong>
            <textarea value={result.observed_result} onChange={(event) => updateVerificationResult(index, { observed_result: event.target.value })} placeholder="実際に得た計算・出力・判定根拠（10文字以上）" maxLength={1200} rows={3} />
            <label><input type="checkbox" checked={result.passed} onChange={(event) => updateVerificationResult(index, { passed: event.target.checked })} />期待値と照合して合格</label>
          </div>)}
          <textarea value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder="不合格時は10文字以上の差し戻し理由" maxLength={500} rows={2} />
          <button onClick={() => void run(() => api.verifyDiagnosticOriginalProblem(content.id, content.revision, verificationResults, verificationNote))} disabled={busy || verificationResults.some((result) => result.observed_result.trim().length < 10) || (verificationResults.some((result) => !result.passed) && verificationNote.trim().length < 10)}><ClipboardCheck />検証結果を確定</button>
        </> : content.verification_status !== "passed" ? <p><ShieldCheck />作成者・提出者とは異なるreviewer / adminによる独立検証が必要です。</p> : canApprove ? <>
          <h4>ステップ2 / 2　最終承認</h4>
          <p><CheckCircle2 />現在の内容 v{content.verification_revision} は、別担当者による独立検証に合格しています。</p>
          <label><input type="checkbox" checked={reviewChecks.statement_matches_blueprint} onChange={(event) => setReviewChecks((current) => ({ ...current, statement_matches_blueprint: event.target.checked }))} />問題本文が承認仕様を直接測定</label>
          <label><input type="checkbox" checked={reviewChecks.scoring_calibrated} onChange={(event) => setReviewChecks((current) => ({ ...current, scoring_calibrated: event.target.checked }))} />採点例と加重得点が整合</label>
          <label><input type="checkbox" checked={reviewChecks.originality_confirmed} onChange={(event) => setReviewChecks((current) => ({ ...current, originality_confirmed: event.target.checked }))} />第三者問題の複製ではない</label>
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="差し戻し時は10文字以上の修正理由" maxLength={500} rows={2} />
          <div><button onClick={() => void run(() => api.reviewDiagnosticOriginalProblem(content.id, content.revision, "approved", reviewNote, reviewChecks))} disabled={busy || !Object.values(reviewChecks).every(Boolean)}><CheckCircle2 />承認して問題化</button><button className="reject" onClick={() => void run(() => api.reviewDiagnosticOriginalProblem(content.id, content.revision, "rejected", reviewNote, reviewChecks))} disabled={busy || reviewNote.trim().length < 10}><X />差し戻す</button></div>
        </> : <p><ShieldCheck />検証者とは別のreviewer / adminによる最終承認が必要です。</p>}
      </div> : null}
      {content.verification_runs.length > 0 ? <details className="diagnostic-content-verification-history"><summary>独立検証履歴 {content.verification_runs.length}件</summary>{content.verification_runs.map((run) => <div key={run.id}><strong>{run.outcome === "passed" ? "合格" : "不合格"}・内容 v{run.content_revision}</strong><span>{run.created_at} / {run.verifier_id}</span>{run.note ? <p>{run.note}</p> : null}</div>)}</details> : null}
      {content.status === "approved" ? <p className="diagnostic-content-author-materialized"><CheckCircle2 />承認済み問題として診断リンク・概念エッジ・学習計画候補へ反映済みです。</p> : null}
    </article>
  );
}

export function DiagnosticProblemContentAdmin({ user }: { user: User }) {
  const [queue, setQueue] = useState<DiagnosticProblemAuthoringQueue | null>(null);
  const [filter, setFilter] = useState<Filter>("not_started");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.diagnosticOriginalProblems();
      if (sequence === requestSequence.current) setQueue(response.authoring_queue);
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "問題制作キューを読み込めませんでした。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, []);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return (queue?.items ?? []).filter((item) => (filter === "all" || item.state === filter)
      && (!normalized || `${item.blueprint.title} ${item.content?.problem_label ?? ""}`.toLocaleLowerCase("ja").includes(normalized)));
  }, [filter, query, queue]);

  async function create(blueprintId: string) {
    setBusyId(blueprintId);
    setError("");
    try {
      await api.createDiagnosticOriginalProblem(blueprintId);
      setFilter("drafting");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "問題下書きを作成できませんでした。");
    } finally {
      setBusyId(null);
    }
  }

  return <section className="panel diagnostic-content-author-panel">
    <header className="diagnostic-content-author-header"><div><span>ORIGINAL ITEM PRODUCTION QA</span><h2>オリジナル診断問題の制作</h2><p>承認仕様から問題本文・模範解答・採点例を制作し、仕様審査とは別に内容を検証します。</p></div><button onClick={() => void load()} disabled={loading}><RefreshCw />{loading ? "更新中" : "再集計"}</button></header>
    {queue ? <div className="diagnostic-content-author-kpis">
      <button className={filter === "not_started" ? "active" : ""} onClick={() => setFilter("not_started")}><Plus /><span>制作待ち</span><strong>{queue.summary.not_started}</strong></button>
      <button className={filter === "drafting" ? "active" : ""} onClick={() => setFilter("drafting")}><FilePenLine /><span>制作中</span><strong>{queue.summary.drafting}</strong></button>
      <button className={filter === "in_review" ? "active" : ""} onClick={() => setFilter("in_review")}><ClipboardCheck /><span>内容審査</span><strong>{queue.summary.pending_review}</strong></button>
      <button className={filter === "approved" ? "active" : ""} onClick={() => setFilter("approved")}><CheckCircle2 /><span>問題化済み</span><strong>{queue.summary.materialized_problems}</strong></button>
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><FlaskConical /><span>承認仕様</span><strong>{queue.summary.approved_blueprints}</strong></button>
    </div> : null}
    {queue ? <p className="diagnostic-content-author-note">独立検証待ち {queue.summary.pending_verification}件・検証済み最終承認待ち {queue.summary.verified_pending_approval}件・検証履歴 {queue.summary.verification_runs}件{queue.summary.verification_pass_rate === null ? "（合格率は20件蓄積後に表示）" : `・合格率 ${Math.round(queue.summary.verification_pass_rate * 100)}%`}</p> : null}
    {error ? <p className="form-status error" role="alert">{error}</p> : null}
    <div className="diagnostic-content-author-toolbar"><label><Search /><span className="sr-only">問題制作を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="承認仕様・問題名で検索" /></label><span>{visibleItems.length}件</span></div>
    <div className="diagnostic-content-author-list" aria-busy={loading}>
      {!loading && visibleItems.length === 0 ? <p className="diagnostic-content-author-empty">条件に一致する問題制作はありません。</p> : null}
      {visibleItems.map((item, index) => <details key={item.blueprint.id} open={index < 2} className={`diagnostic-content-author-item ${item.state}`}>
        <summary><span><strong>{item.blueprint.title}</strong><small>{item.blueprint.cognitive_demand}・{item.blueprint.answer_format}・{item.blueprint.estimated_minutes}分</small></span><span>{STATE_LABELS[item.state]}</span></summary>
        <div className="diagnostic-content-author-body">
          <div className="diagnostic-content-author-spec"><div><small>測定目的</small><p>{item.blueprint.assessment_objective}</p></div><div><small>観測証拠</small><p>{item.blueprint.evidence_expectation}</p></div><div><small>想定誤答</small><ul>{item.blueprint.misconception_targets.map((target) => <li key={target}>{target}</li>)}</ul></div></div>
          {!item.content ? <button className="diagnostic-content-author-create" onClick={() => void create(item.blueprint.id)} disabled={busyId === item.blueprint.id}><Plus />問題制作の下書きを開始</button> : <ContentEditor key={`${item.content.id}:${item.content.revision}`} item={item} user={user} onChanged={load} />}
        </div>
      </details>)}
    </div>
    <footer>承認時だけ問題・概念エッジ・診断リンクを同時に生成します。一般の問題編集APIから承認済みオリジナル問題を変更することはできません。</footer>
  </section>;
}
