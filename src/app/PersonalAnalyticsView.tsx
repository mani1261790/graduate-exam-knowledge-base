import { useEffect, useState, type ReactNode } from "react";
import { Activity, ArrowRight, BrainCircuit, CalendarDays, Compass, Eye, FlaskConical, Gauge, Lightbulb, RefreshCw, Repeat2, ShieldCheck, Sparkles, Target, TimerReset, TrendingUp } from "lucide-react";
import { api } from "./api";
import type { PersonalAnalytics, StudyGoal, StudyPlanResponse } from "./types";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function minutesLabel(value: number): string {
  if (value < 60) return `${value}分`;
  return `${Math.floor(value / 60)}時間${value % 60 ? `${value % 60}分` : ""}`;
}

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function signedPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}pt`;
}

export function PersonalAnalyticsPage({
  onPractice,
  onStudyPlan,
  onScheduleAdapted,
  onPlanFocused,
}: {
  onPractice?: (mode: PersonalAnalytics["strategy"]["recommended_mode"]) => void;
  onStudyPlan?: () => void;
  onScheduleAdapted?: (goal: StudyGoal, plan: StudyPlanResponse) => void;
  onPlanFocused?: (plan: StudyPlanResponse) => void;
}) {
  const [analytics, setAnalytics] = useState<PersonalAnalytics | null>(null);
  const [busy, setBusy] = useState(true);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [informationBusy, setInformationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.personalAnalytics();
      setAnalytics(response.analytics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "分析結果を読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function acceptStrategy(mode: PersonalAnalytics["strategy"]["recommended_mode"], experimentId: string) {
    if (!onPractice) return;
    setStrategyBusy(true);
    setError(null);
    try {
      await api.acceptPersonalStrategy(experimentId);
      onPractice(mode);
    } catch (strategyError) {
      setError(strategyError instanceof Error ? strategyError.message : "学習戦略を開始できませんでした。");
    } finally {
      setStrategyBusy(false);
    }
  }

  async function acceptSchedule(experimentId: string) {
    setScheduleBusy(true);
    setError(null);
    try {
      const response = await api.acceptScheduleAdaptation(experimentId);
      if (onScheduleAdapted) onScheduleAdapted(response.goal, response.study_plan);
      else await load();
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "学習日程を再配分できませんでした。");
    } finally {
      setScheduleBusy(false);
    }
  }

  async function acceptPlanFocus(experimentId: string) {
    setFocusBusy(true);
    setError(null);
    try {
      const response = await api.acceptPlanFocus(experimentId);
      if (onPlanFocused) onPlanFocused(response.study_plan);
      else await load();
    } catch (focusError) {
      setError(focusError instanceof Error ? focusError.message : "重点学習プランを開始できませんでした。");
    } finally {
      setFocusBusy(false);
    }
  }

  async function acceptInformationGain(experimentId: string) {
    setInformationBusy(true);
    setError(null);
    try {
      const response = await api.acceptInformationGain(experimentId);
      if (onPlanFocused) onPlanFocused(response.study_plan);
      else await load();
    } catch (informationError) {
      setError(informationError instanceof Error ? informationError.message : "未知分野の確認枠を開始できませんでした。");
    } finally {
      setInformationBusy(false);
    }
  }

  if (busy && !analytics) return <div className="analytics-loading">学習記録を分析しています...</div>;
  if (error && !analytics) return <div className="analytics-error" role="alert"><p>{error}</p><button onClick={() => void load()}><RefreshCw />再読み込み</button></div>;
  if (!analytics) return null;
  return <PersonalAnalyticsDashboard analytics={analytics} busy={busy} strategyBusy={strategyBusy} scheduleBusy={scheduleBusy} focusBusy={focusBusy} informationBusy={informationBusy} error={error} onReload={load} onPractice={acceptStrategy} onStudyPlan={onStudyPlan} onAcceptSchedule={acceptSchedule} onAcceptPlanFocus={acceptPlanFocus} onAcceptInformationGain={acceptInformationGain} />;
}

function PersonalAnalyticsDashboard({
  analytics,
  busy,
  strategyBusy,
  scheduleBusy,
  focusBusy,
  informationBusy,
  error,
  onReload,
  onPractice,
  onStudyPlan,
  onAcceptSchedule,
  onAcceptPlanFocus,
  onAcceptInformationGain,
}: {
  analytics: PersonalAnalytics;
  busy: boolean;
  strategyBusy: boolean;
  scheduleBusy: boolean;
  focusBusy: boolean;
  informationBusy: boolean;
  error: string | null;
  onReload: () => Promise<void>;
  onPractice?: (mode: PersonalAnalytics["strategy"]["recommended_mode"], experimentId: string) => Promise<void>;
  onStudyPlan?: () => void;
  onAcceptSchedule?: (experimentId: string) => Promise<void>;
  onAcceptPlanFocus?: (experimentId: string) => Promise<void>;
  onAcceptInformationGain?: (experimentId: string) => Promise<void>;
}) {
  const maxWeeklyAttempts = Math.max(1, ...analytics.trends.map((trend) => trend.attempts));
  const weakestConcepts = analytics.concepts.slice(0, 8);
  const calibrationLabel = {
    insufficient: "記録を蓄積中",
    well_calibrated: "自己評価が安定",
    overconfident: "自信が先行",
    underconfident: "実力を控えめに評価",
  }[analytics.calibration.status];
  const modelQualityLabel = {
    insufficient: "評価データを蓄積中",
    improving: "ベースラインより改善",
    neutral: "差は未確定",
    regressing: "要見直し",
  }[analytics.model_quality.status];
  const modelQualityProgress = Math.min(100, Math.round((analytics.model_quality.sample_count / analytics.model_quality.minimum_sample_size) * 100));
  const modeLabel = { normal: "バランス", review: "復習", foundation: "基礎", challenge: "発展" }[analytics.strategy.recommended_mode];
  const evaluationModeLabel = analytics.strategy_evaluation
    ? { normal: "バランス", review: "復習", foundation: "基礎", challenge: "発展" }[analytics.strategy_evaluation.recommended_mode]
    : null;
  const strategyConfidenceLabel = { low: "仮説段階", medium: "参考にできる", high: "根拠が複数一致" }[analytics.strategy.confidence];
  const diagnosticStatusLabels = {
    insufficient: "収集中",
    improving: "改善",
    stable: "安定",
    declining: "低下",
    balanced: "差は小さい",
    support_dependent: "補助差あり",
    independent_strong: "自力が安定",
    overtime_cost: "時間超過に課題",
    careful_working: "慎重型",
  } as const;
  const readiness = analytics.goal_readiness;
  const readinessStatusLabel = readiness ? {
    no_goal: "目標未設定",
    collecting: "証拠を収集中",
    progressing: "進行中",
    on_track: "計画どおり",
    at_risk: "立て直しが必要",
    target_passed: "目標日の更新が必要",
  }[readiness.status] : null;

  return (
    <section className="analytics-page">
      <header className="analytics-hero">
        <div>
          <span className="dashboard-eyebrow">PERSONAL LEARNING ANALYTICS</span>
          <h1>学習分析</h1>
          <p>点数だけでなく、推定の確かさ・解答速度・自己評価のずれから、次の一手を整理します。</p>
        </div>
        <button className="analytics-refresh" onClick={() => void onReload()} disabled={busy}>
          <RefreshCw className={busy ? "spinning" : ""} />{busy ? "更新中" : "再分析"}
        </button>
      </header>
      {error ? <p className="form-status error" role="alert">{error}</p> : null}

      <div className="analytics-kpi-grid" aria-label="学習サマリー">
        <Metric icon={<Activity />} label={`学習記録（直近${analytics.model.window_days}日）`} value={`${analytics.summary.total_attempts}問`} detail={`${analytics.summary.active_days}日活動`} />
        <Metric icon={<TimerReset />} label="学習時間" value={minutesLabel(analytics.summary.total_minutes)} detail={`${analytics.summary.current_streak_days}日連続`} />
        <Metric icon={<Gauge />} label="平均達成度" value={percent(analytics.summary.average_score)} detail={`成功率 ${percent(analytics.summary.success_rate)}`} />
        <Metric icon={<ShieldCheck />} label="推定の確かさ" value={percent(analytics.summary.evidence_strength)} detail="証拠量と鮮度から算出" />
      </div>

      {readiness ? (
        <section className={`panel goal-readiness ${readiness.status}`}>
          <div className="goal-readiness-head">
            <div className="analytics-section-title"><Target /><div><span>GOAL READINESS</span><h2>{readiness.goal_label ?? "目標準備度"}</h2><p>{readiness.target_date ? `${new Date(`${readiness.target_date}T00:00:00+09:00`).toLocaleDateString("ja-JP")}まで${readiness.days_remaining !== null && readiness.days_remaining >= 0 ? `あと${readiness.days_remaining}日` : ""}` : "目標日を設定すると残り期間も評価します"}</p></div></div>
            <strong className={`goal-readiness-status ${readiness.status}`}>{readinessStatusLabel}</strong>
          </div>
          {readiness.status === "no_goal" ? (
            <div className="goal-readiness-empty"><p>{readiness.message}</p><button onClick={onStudyPlan} disabled={!onStudyPlan}>目標を設定する<ArrowRight /></button></div>
          ) : (
            <>
              <div className="goal-readiness-layout">
                <div className="readiness-score" role="img" aria-label={`目標準備度 ${percent(readiness.readiness_score)}`}>
                  <small>証拠調整済み準備度</small>
                  <strong>{percent(readiness.readiness_score)}</strong>
                  <span>推定幅 {percent(readiness.lower_bound)}〜{percent(readiness.upper_bound)}</span>
                </div>
                <div className="readiness-metrics">
                  <article><small>目標分野の証拠</small><strong>{readiness.sufficiently_observed_concepts} / {readiness.target_concepts}</strong><span>充足率 {percent(readiness.evidence_coverage)}</span></article>
                  <article><small>計画遵守</small><strong>{percent(readiness.plan_adherence)}</strong><span>{readiness.completed_due_sessions} / {readiness.due_plan_sessions}日完了</span></article>
                  <article><small>週あたり学習日</small><strong>{readiness.current_weekly_pace}日</strong><span>目標 {readiness.required_weekly_pace}日</span></article>
                  <article><small>期限超過</small><strong>{readiness.overdue_sessions}日</strong><span>次の7日 {readiness.upcoming_sessions_7d}日</span></article>
                </div>
              </div>
              <div className="goal-readiness-guidance"><div><p>{readiness.message}</p><strong>{readiness.action}</strong></div><button onClick={onStudyPlan} disabled={!onStudyPlan}>計画を調整<ArrowRight /></button></div>
              {readiness.history.length > 1 ? (
                <div className="readiness-history"><div><TrendingUp /><strong>準備度の推移</strong><span>直近{readiness.history.length}日</span></div><div role="img" aria-label="目標準備度の日次推移">{readiness.history.map((point) => <span key={point.snapshot_date} title={`${point.snapshot_date}: ${percent(point.readiness_score)}`} style={{ height: `${Math.max(6, point.readiness_score * 100)}%` }} />)}</div></div>
              ) : null}
              <small className="readiness-caveat">準備度は合否確率ではありません。対象分野の保守的習熟度、計画遵守、直近4週間の学習日数を統合した行動判断用の指標です。</small>
            </>
          )}
        </section>
      ) : null}

      {analytics.schedule_adaptation ? (
        <section className={`panel schedule-adaptation ${analytics.schedule_adaptation.status}`}>
          <div className="schedule-adaptation-head">
            <div className="analytics-section-title"><CalendarDays /><div><span>SCHEDULE FIT</span><h2>学習時間を保ったまま曜日を再配分</h2><p>{analytics.schedule_adaptation.message}</p></div></div>
            <strong>{analytics.schedule_adaptation.status === "proposal" ? "提案" : analytics.schedule_adaptation.status === "monitoring" ? "14日間を検証中" : analytics.schedule_adaptation.status === "improving" ? "改善" : analytics.schedule_adaptation.status === "regressing" ? "要見直し" : "差は小さい"}</strong>
          </div>
          <div className="schedule-adaptation-comparison">
            <article><small>現在</small><strong>週{analytics.schedule_adaptation.current_sessions_per_week}日 × {analytics.schedule_adaptation.current_minutes_per_session}分</strong><span>週{analytics.schedule_adaptation.weekly_minutes_before}分</span></article>
            <ArrowRight />
            <article><small>提案</small><strong>週{analytics.schedule_adaptation.proposed_sessions_per_week}日 × {analytics.schedule_adaptation.proposed_minutes_per_session}分</strong><span>週{analytics.schedule_adaptation.weekly_minutes_after}分</span></article>
          </div>
          <p>{analytics.schedule_adaptation.rationale}</p>
          {analytics.schedule_adaptation.status === "proposal" ? (
            <button onClick={() => void onAcceptSchedule?.(analytics.schedule_adaptation!.experiment_id)} disabled={!onAcceptSchedule || scheduleBusy}>
              {scheduleBusy ? "再配分中..." : "この配分を14日間試す"}<ArrowRight />
            </button>
          ) : analytics.schedule_adaptation.completed_at ? (
            <dl><div><dt>採用前の遵守</dt><dd>{percent(analytics.schedule_adaptation.baseline_plan_adherence)}</dd></div><div><dt>採用後</dt><dd>{percent(analytics.schedule_adaptation.followup_plan_adherence)}</dd></div><div><dt>変化</dt><dd>{signedPercent(analytics.schedule_adaptation.adherence_uplift)}</dd></div></dl>
          ) : (
            <small>採用前 {percent(analytics.schedule_adaptation.baseline_plan_adherence)} / 採用後は{analytics.schedule_adaptation.followup_due_sessions ?? 0}予定日を観測</small>
          )}
          <small className="schedule-adaptation-caveat">本人内の前後比較であり、曜日変更だけの因果効果とは断定しません。いつでも学習計画から再変更できます。</small>
        </section>
      ) : null}

      {analytics.plan_focus ? (
        <section className={`panel plan-focus ${analytics.plan_focus.status}`}>
          <div className="schedule-adaptation-head">
            <div className="analytics-section-title"><Target /><div><span>FOCUS POLICY</span><h2>実測ボトルネックへ重点配分</h2><p>{analytics.plan_focus.message}</p></div></div>
            <strong>{analytics.plan_focus.status === "proposal" ? "提案" : analytics.plan_focus.status === "monitoring" ? "14日間を検証中" : analytics.plan_focus.status === "improving" ? "改善" : analytics.plan_focus.status === "regressing" ? "要見直し" : "差は小さい"}</strong>
          </div>
          <div className="plan-focus-targets">
            <small>重点候補</small>
            <strong>{analytics.plan_focus.focus_node_labels.join("・")}</strong>
            <span>保守的習熟度 {percent(analytics.plan_focus.baseline_focus_mastery)}</span>
          </div>
          <div className="plan-focus-comparison">
            <Distribution title="現在の分散計画" items={analytics.plan_focus.baseline_distribution} />
            <ArrowRight />
            <Distribution title="重点配分案" items={analytics.plan_focus.proposed_distribution} />
          </div>
          <p>{analytics.plan_focus.rationale}</p>
          {analytics.plan_focus.status === "proposal" ? (
            <button onClick={() => void onAcceptPlanFocus?.(analytics.plan_focus!.experiment_id)} disabled={!onAcceptPlanFocus || focusBusy}>
              {focusBusy ? "重点計画を作成中..." : "この配分を14日間試す"}<ArrowRight />
            </button>
          ) : analytics.plan_focus.completed_at ? (
            <dl>
              <div><dt>重点習熟の変化</dt><dd>{signedPercent(analytics.plan_focus.focus_mastery_uplift)}</dd></div>
              <div><dt>計画遵守の変化</dt><dd>{signedPercent(analytics.plan_focus.adherence_uplift)}</dd></div>
              <div><dt>範囲カバー</dt><dd>{percent(analytics.plan_focus.coverage_rate)}</dd></div>
            </dl>
          ) : (
            <small>採用前の重点習熟 {percent(analytics.plan_focus.baseline_focus_mastery)} / 14日後に{analytics.plan_focus.followup_due_sessions ?? 0}予定日を評価</small>
          )}
          <small className="schedule-adaptation-caveat">未観測分野は弱点とみなしません。本人が採用した前後の比較であり、重点配分だけの因果効果とは断定しません。</small>
        </section>
      ) : null}

      {analytics.information_gain ? (
        <section className={`panel information-gain ${analytics.information_gain.status}`}>
          <div className="schedule-adaptation-head">
            <div className="analytics-section-title"><Eye /><div><span>DIAGNOSTIC EXPLORATION</span><h2>未知分野を短く確認</h2><p>{analytics.information_gain.message}</p></div></div>
            <strong>{analytics.information_gain.status === "proposal" ? "提案" : analytics.information_gain.status === "monitoring" ? "確認中" : analytics.information_gain.status === "evidence_acquired" ? "証拠取得" : analytics.information_gain.status === "completed" ? "取得完了" : "未取得"}</strong>
          </div>
          <div className="plan-focus-targets">
            <small>確認候補</small>
            <strong>{analytics.information_gain.exploration_node_label}</strong>
            <span>提案時の実測証拠 {analytics.information_gain.baseline_evidence_count}件 / 確認枠 {analytics.information_gain.exploration_sessions}回</span>
          </div>
          <div className="plan-focus-comparison">
            <Distribution title="現在の分散計画" items={analytics.information_gain.baseline_distribution} />
            <ArrowRight />
            <Distribution title="最初に確認する案" items={analytics.information_gain.proposed_distribution} />
          </div>
          <p>{analytics.information_gain.rationale}</p>
          {analytics.information_gain.status === "proposal" ? (
            <button onClick={() => void onAcceptInformationGain?.(analytics.information_gain!.experiment_id)} disabled={!onAcceptInformationGain || informationBusy}>
              {informationBusy ? "確認計画を作成中..." : "この確認枠を試す"}<ArrowRight />
            </button>
          ) : analytics.information_gain.completed_at ? (
            <dl>
              <div><dt>14日以内の証拠</dt><dd>{analytics.information_gain.evidence_acquired_at ? "取得" : "未取得"}</dd></div>
              <div><dt>取得まで</dt><dd>{analytics.information_gain.evidence_latency_hours === null ? "—" : `${Math.round(analytics.information_gain.evidence_latency_hours)}時間`}</dd></div>
              <div><dt>遵守 / 範囲</dt><dd>{percent(analytics.information_gain.followup_plan_adherence)} / {percent(analytics.information_gain.coverage_rate)}</dd></div>
            </dl>
          ) : (
            <small>{analytics.information_gain.evidence_acquired_at ? "証拠取得済み。分散計画へ復帰しました。" : "最初の解答記録が得られるまで最大20%だけ前倒しします。"}</small>
          )}
          <small className="schedule-adaptation-caveat">未観測は弱点ではありません。主指標は14日以内の情報獲得率で、習熟改善の因果効果とは扱いません。</small>
        </section>
      ) : null}

      {analytics.diagnostic_item ? (
        <section className={`panel diagnostic-item ${analytics.diagnostic_item.observed_at ? "observed" : "monitoring"}`}>
          <div className="schedule-adaptation-head">
            <div className="analytics-section-title"><Gauge /><div><span>DIAGNOSTIC ITEM VALUE</span><h2>確認効果の高い1問を選定</h2><p>{analytics.diagnostic_item.message}</p></div></div>
            <strong>{analytics.diagnostic_item.observed_at ? "解答済み" : "確認待ち"}</strong>
          </div>
          <div className="diagnostic-item-problem">
            <small>選定した確認問題</small>
            <strong>{analytics.diagnostic_item.selected_problem_label}</strong>
          </div>
          <dl>
            <div><dt>直接測れる概念</dt><dd>{analytics.diagnostic_item.direct_concept_count} / {analytics.diagnostic_item.target_concept_count}</dd></div>
            <div><dt>目安時間</dt><dd>{analytics.diagnostic_item.estimated_minutes}分</dd></div>
            <div><dt>情報効率スコア</dt><dd>{percent(analytics.diagnostic_item.selected_utility)}</dd></div>
            <div><dt>比較可能な候補</dt><dd>{analytics.diagnostic_item.comparable_candidate_count} / {analytics.diagnostic_item.candidate_problem_count}問</dd></div>
          </dl>
          {analytics.diagnostic_item.observed_at ? (
            <dl>
              <div><dt>直接証拠</dt><dd>{analytics.diagnostic_item.observed_direct_evidence_count ?? 0}件</dd></div>
              <div><dt>対象内の証拠増加</dt><dd>{analytics.diagnostic_item.observed_total_evidence_gain ?? 0}件</dd></div>
              <div><dt>実測時間</dt><dd>{analytics.diagnostic_item.observed_time_minutes === null ? "—" : `${analytics.diagnostic_item.observed_time_minutes}分`}</dd></div>
            </dl>
          ) : null}
          <small className="schedule-adaptation-caveat">
            {!analytics.diagnostic_item.ranking_opportunity
              ? "意味のある効用差を持つ比較候補が2問未満だったため、従来候補を維持しました。"
              : analytics.diagnostic_item.selection_changed
                ? `比較候補から、従来候補より情報効率の代理スコアが${signedPercent(analytics.diagnostic_item.selected_utility - analytics.diagnostic_item.baseline_utility)}高い1問へ変更しました。`
                : `${analytics.diagnostic_item.comparable_candidate_count}問を比較し、従来候補が最高評価だったため維持しました。`}
            このスコアは習熟効果を保証せず、実測証拠と所要時間で継続評価します。
          </small>
        </section>
      ) : null}

      <section className={`panel learning-strategy ${analytics.strategy.recommended_mode}`}>
        <div className="strategy-icon"><Compass /></div>
        <div>
          <span>次の学習戦略・{strategyConfidenceLabel}</span>
          <h2>{analytics.strategy.title}</h2>
          <ul>{analytics.strategy.rationale.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
        <button
          onClick={() => analytics.strategy.experiment_id && onPractice?.(analytics.strategy.recommended_mode, analytics.strategy.experiment_id)}
          disabled={!onPractice || !analytics.strategy.experiment_id || strategyBusy}
        >
          {strategyBusy ? "採用中..." : `${modeLabel}モードを開く`}<ArrowRight />
        </button>
      </section>

      {analytics.strategy_evaluation ? (
        <section className={`panel strategy-evaluation ${analytics.strategy_evaluation.status}`}>
          <div><FlaskConical /><span>採用した戦略の検証</span></div>
          <strong>{evaluationModeLabel}モードで {analytics.strategy_evaluation.matched_attempt_count} / {analytics.strategy_evaluation.required_attempts}問</strong>
          <p>{analytics.strategy_evaluation.message}</p>
          {analytics.strategy_evaluation.completed_at ? (
            <dl>
              <div><dt>採用前</dt><dd>{percent(analytics.strategy_evaluation.baseline_score)}</dd></div>
              <div><dt>採用後</dt><dd>{percent(analytics.strategy_evaluation.followup_score)}</dd></div>
              <div><dt>変化</dt><dd>{signedPercent(analytics.strategy_evaluation.score_uplift)}</dd></div>
            </dl>
          ) : null}
        </section>
      ) : null}

      <section className="panel personal-diagnostics">
        <div className="analytics-section-title"><Lightbulb /><div><h2>学習法の本人内比較</h2><p>他人との順位ではなく、自分の条件違いを最低3件ずつ比較します。</p></div></div>
        <div className="diagnostic-grid">
          <article className={analytics.diagnostics.retention.status}>
            <header><Repeat2 /><div><small>間隔を空けた再挑戦</small><strong>定着の再現性</strong></div><span>{diagnosticStatusLabels[analytics.diagnostics.retention.status]}</span></header>
            <p>{analytics.diagnostics.retention.message}</p>
            <dl><div><dt>比較組</dt><dd>{analytics.diagnostics.retention.sample_pairs} / {analytics.diagnostics.retention.minimum_pairs}</dd></div><div><dt>達成度変化</dt><dd>{signedPercent(analytics.diagnostics.retention.average_score_change)}</dd></div><div><dt>間隔中央値</dt><dd>{analytics.diagnostics.retention.median_interval_days === null ? "—" : `${analytics.diagnostics.retention.median_interval_days}日`}</dd></div></dl>
          </article>
          <article className={analytics.diagnostics.independence.status}>
            <header><BrainCircuit /><div><small>ヒント・解答参照</small><strong>自力再現</strong></div><span>{diagnosticStatusLabels[analytics.diagnostics.independence.status]}</span></header>
            <p>{analytics.diagnostics.independence.message}</p>
            <dl><div><dt>補助なし</dt><dd>{analytics.diagnostics.independence.independent_count}件 / {percent(analytics.diagnostics.independence.independent_score)}</dd></div><div><dt>補助あり</dt><dd>{analytics.diagnostics.independence.assisted_count}件 / {percent(analytics.diagnostics.independence.assisted_score)}</dd></div><div><dt>補助差</dt><dd>{signedPercent(analytics.diagnostics.independence.assisted_gap)}</dd></div></dl>
          </article>
          <article className={analytics.diagnostics.pacing.status}>
            <header><TimerReset /><div><small>目安時間の125%</small><strong>時間配分</strong></div><span>{diagnosticStatusLabels[analytics.diagnostics.pacing.status]}</span></header>
            <p>{analytics.diagnostics.pacing.message}</p>
            <dl><div><dt>時間内</dt><dd>{analytics.diagnostics.pacing.on_time_count}件 / {percent(analytics.diagnostics.pacing.on_time_score)}</dd></div><div><dt>時間超過</dt><dd>{analytics.diagnostics.pacing.overtime_count}件 / {percent(analytics.diagnostics.pacing.overtime_score)}</dd></div><div><dt>時間内優位</dt><dd>{signedPercent(analytics.diagnostics.pacing.on_time_advantage)}</dd></div></dl>
          </article>
        </div>
        <small className="diagnostic-caveat">問題難度や出題形式の差を完全には調整していないため、診断ではなく次の演習条件を選ぶ参考値として使います。</small>
      </section>

      <div className="analytics-main-grid">
        <section className="panel analytics-insights">
          <div className="analytics-section-title"><Sparkles /><div><h2>次に取る行動</h2><p>現在の記録から優先度順に提案します。</p></div></div>
          <div className="insight-list">
            {analytics.insights.map((insight) => (
              <article key={insight.id} className={`insight-card ${insight.tone}`}>
                <div><strong>{insight.title}</strong><p>{insight.body}</p></div>
                <span>{insight.action}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel calibration-card">
          <div className="analytics-section-title"><BrainCircuit /><div><h2>自己評価の較正</h2><p>自信度と実際の達成度を比較します。</p></div></div>
          <strong className={`calibration-status ${analytics.calibration.status}`}>{calibrationLabel}</strong>
          <p>{analytics.calibration.message}</p>
          <dl>
            <div><dt>自信度つき記録</dt><dd>{analytics.calibration.sample_count}件</dd></div>
            <div><dt>平均自信度</dt><dd>{percent(analytics.calibration.mean_confidence)}</dd></div>
            <div><dt>実際の達成度</dt><dd>{percent(analytics.calibration.mean_score)}</dd></div>
            <div><dt>較正スコア</dt><dd>{percent(analytics.summary.calibration_score)}</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel model-quality-panel">
        <div className="analytics-section-title"><FlaskConical /><div><h2>モデル品質</h2><p>推薦時の予測と、その後に解いた結果を照合します。</p></div></div>
        <div className="model-quality-layout">
          <div>
            <strong className={`model-quality-status ${analytics.model_quality.status}`}>{modelQualityLabel}</strong>
            <p>{analytics.model_quality.message}</p>
            <div className="model-quality-progress" role="progressbar" aria-valuemin={0} aria-valuemax={analytics.model_quality.minimum_sample_size} aria-valuenow={Math.min(analytics.model_quality.sample_count, analytics.model_quality.minimum_sample_size)}>
              <span style={{ width: `${modelQualityProgress}%` }} />
            </div>
            <small>{analytics.model_quality.sample_count} / {analytics.model_quality.minimum_sample_size}件で一次判定</small>
          </div>
          <dl>
            <div><dt>個人化MAE</dt><dd>{analytics.model_quality.personalized_mae === null ? "—" : analytics.model_quality.personalized_mae.toFixed(3)}</dd></div>
            <div><dt>ベースラインMAE</dt><dd>{analytics.model_quality.baseline_mae === null ? "—" : analytics.model_quality.baseline_mae.toFixed(3)}</dd></div>
            <div><dt>誤差改善</dt><dd>{analytics.model_quality.mae_improvement === null ? "—" : `${analytics.model_quality.mae_improvement >= 0 ? "+" : ""}${analytics.model_quality.mae_improvement.toFixed(3)}`}</dd></div>
            <div><dt>勝率</dt><dd>{percent(analytics.model_quality.win_rate)}</dd></div>
          </dl>
        </div>
        <small className="model-quality-note">MAEは小さいほど良く、「誤差改善」はベースラインMAE − 個人化MAEです。20件未満では優劣を判定しません。</small>
      </section>

      <section className="panel mastery-evidence-panel">
        <div className="analytics-section-title"><ShieldCheck /><div><h2>習熟度を作った答案証拠</h2><p>同じ分野の答案が一貫しているかを確認し、矛盾時は弱点と断定しません。</p></div></div>
        {analytics.mastery_evidence.concepts.length === 0 ? <p className="analytics-empty">新しい学習記録から、習熟度の根拠をここに表示します。</p> : <div className="mastery-evidence-stability">
          {analytics.mastery_evidence.concepts.slice(0, 6).map((concept) => <article key={concept.concept_id} className={concept.status}>
            <header><strong>{concept.concept_name}</strong><span>{concept.status === "contradictory" ? "矛盾" : concept.status === "mixed" ? "揺れあり" : concept.status === "stable" ? "一貫" : "収集中"}</span></header>
            <dl><div><dt>答案</dt><dd>{concept.sample_count}件</dd></div><div><dt>平均証拠</dt><dd>{percent(concept.mean_evidence)}</dd></div><div><dt>レンジ</dt><dd>{percent(concept.evidence_range)}</dd></div></dl>
            <p>{concept.message}</p>
          </article>)}
        </div>}
        {analytics.mastery_evidence.recent.length > 0 ? <div className="mastery-evidence-timeline">
          <h3>最近の更新</h3>
          {analytics.mastery_evidence.recent.slice(0, 8).map((evidence) => <article key={evidence.id}>
            <div><strong>{evidence.concept_name}</strong><span>{evidence.problem_label}・難度{evidence.difficulty}</span></div>
            <dl><div><dt>答案証拠</dt><dd>{percent(evidence.raw_evidence)}</dd></div><div><dt>更新前</dt><dd>{percent(evidence.previous_mastery)}</dd></div><div><dt>更新後</dt><dd>{percent(evidence.current_prediction)}</dd></div></dl>
            <time dateTime={evidence.created_at}>{new Date(evidence.created_at).toLocaleDateString("ja-JP")}</time>
          </article>)}
        </div> : null}
        <small className="model-quality-note">本人の答案だけを表示します。校正待ちで習熟度へ反映しなかった問題はこの証拠一覧へ入りません。{analytics.mastery_evidence.model_version}</small>
      </section>

      <div className="analytics-detail-grid">
        <section className="panel concept-confidence-panel">
          <div className="analytics-section-title"><ShieldCheck /><div><h2>分野別の習熟推定</h2><p>薄い色は現在値、濃い線は証拠の不確かさを差し引いた値です。</p></div></div>
          {weakestConcepts.length === 0 ? <p className="analytics-empty">問題を解くと、分野ごとの推定がここに表示されます。</p> : null}
          <div className="concept-confidence-list">
            {weakestConcepts.map((concept) => (
              <article key={concept.id}>
                <div className="concept-confidence-head">
                  <strong>{concept.name_ja}</strong>
                  <span>保守推定 {percent(concept.conservative_mastery)} / 確かさ {percent(concept.confidence)}</span>
                </div>
                <div className="confidence-track" role="img" aria-label={`${concept.name_ja} 習熟度${percent(concept.mastery_score)}、保守推定${percent(concept.conservative_mastery)}`}>
                  <span className="confidence-raw" style={{ width: percent(concept.mastery_score) }} />
                  <span className="confidence-conservative" style={{ width: percent(concept.conservative_mastery) }} />
                </div>
                <small>{concept.evidence_count}件の証拠{concept.needs_evidence ? "・追加確認が必要" : "・推定は安定"}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel weekly-trend-panel">
          <div className="analytics-section-title"><CalendarDays /><div><h2>8週間の学習推移</h2><p>棒の高さは記録した問題数です。</p></div></div>
          {analytics.trends.length === 0 ? <p className="analytics-empty">最初の学習記録から週次推移を表示します。</p> : null}
          <div className="weekly-chart" role="img" aria-label="週ごとの学習問題数">
            {analytics.trends.map((trend) => (
              <div key={trend.week_start} className="weekly-column">
                <span className="weekly-score">{percent(trend.average_score)}</span>
                <div className="weekly-bar-shell"><span style={{ height: `${Math.max(8, (trend.attempts / maxWeeklyAttempts) * 100)}%` }} /></div>
                <strong>{trend.attempts}問</strong>
                <small>{shortDate(trend.week_start)}〜</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <details className="panel analytics-methodology">
        <summary>分析方法と検証中の仮説</summary>
        <p>この分析は診断や合否予測ではありません。学習記録から次の演習を選ぶための推定で、証拠が少ない分野は意図的に控えめに表示します。</p>
        <ul>
          {analytics.model.hypotheses.map((hypothesis) => <li key={hypothesis.id}><strong>{hypothesis.label}</strong><span>評価指標: {hypothesis.metric}</span></li>)}
        </ul>
        <small>
          モデル {analytics.model.version} / 更新 {new Date(analytics.model.generated_at).toLocaleString("ja-JP")}
          {analytics.model.truncated ? ` / ${analytics.model.available_attempts}件中${analytics.model.analyzed_attempts}件を分析` : ""}
        </small>
      </details>
    </section>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article className="analytics-kpi"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function Distribution({ title, items }: {
  title: string;
  items: Array<{ node_id: string; label: string; sessions: number }>;
}) {
  return <article><small>{title}</small><div>{items.map((item) => <span key={item.node_id}><strong>{item.label}</strong><b>{item.sessions}回</b></span>)}</div></article>;
}
