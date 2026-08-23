import { useEffect, useState, type ReactNode } from "react";
import { Activity, CalendarDays, Clock3, Eye, FlaskConical, Gauge, ListOrdered, RefreshCw, ShieldAlert, Target, TrendingUp, UsersRound } from "lucide-react";
import { api } from "./api";
import type { ModelHealth, User } from "./types";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function decimal(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

const CONTENT_GAP_LABELS: Record<ModelHealth["diagnostic_content_coverage"]["priority_gaps"][number]["gap_type"], string> = {
  unmapped: "概念未接続",
  no_direct_problem: "直接問題なし",
  single_direct_problem: "直接問題1問",
};

const CONTENT_NODE_TYPE_LABELS: Record<ModelHealth["diagnostic_content_coverage"]["priority_gaps"][number]["node_type"], string> = {
  FOUNDATIONAL: "前提",
  BASIC: "基礎",
  CORE: "中核",
  APPLICATION: "応用",
};

export function ModelHealthPage({ user }: { user: User }) {
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.modelHealth();
      setHealth(response.model_health);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "モデル監視を読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (busy && !health) return <div className="model-health-loading">モデル評価を集計しています...</div>;
  if (error && !health) return <div className="model-health-error" role="alert"><p>{error}</p><button onClick={() => void load()}><RefreshCw />再読み込み</button></div>;
  if (!health) return null;
  return <ModelHealthDashboard health={health} user={user} busy={busy} error={error} onReload={load} />;
}

function CalibrationControls({ item, user, onChanged }: {
  item: ModelHealth["diagnostic_problem_validity"]["items"][number];
  user: User;
  onChanged: () => Promise<void>;
}) {
  const [rationale, setRationale] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = item.calibration.active;
  const pending = item.calibration.pending;
  const activeMasteryIsCurrent = active?.decision === "mastery_enabled"
    && Boolean(active.valid_until) && Date.parse(active.valid_until!) > Date.now()
    && item.status === "healthy";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setRationale("");
      setReviewNote("");
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "校正判断を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return <div className="diagnostic-calibration-control">
    {active ? <div className={`diagnostic-calibration-state ${active.decision}`}>
      <strong>{active.decision === "mastery_enabled" ? "習熟度反映を有効化" : "観測のみ"}</strong>
      <span>{active.valid_until ? `${new Date(active.valid_until).toLocaleDateString("ja-JP")}まで有効` : "有効期限なし"}</span>
      <p>{active.rationale}</p>
    </div> : <p className="diagnostic-calibration-empty">承認済み校正なし。答案は保存しますが、習熟度には反映しません。</p>}
    {pending ? <div className="diagnostic-calibration-pending">
      <strong>審査待ち: {pending.decision === "mastery_enabled" ? "習熟度反映" : "観測のみ"}</strong>
      <p>{pending.rationale}</p>
      <small>提案者 {pending.proposed_by}・標本 {pending.users}人 / 事前成績 {pending.paired_users}人</small>
      {user.role === "admin" && pending.proposed_by !== user.id ? <>
        <label><span>管理者審査メモ</span><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} rows={2} maxLength={1000} /></label>
        <div className="diagnostic-calibration-actions">
          <button onClick={() => void run(() => api.reviewDiagnosticProblemCalibration(item.content_id, pending.id, { status: "rejected", expected_snapshot_key: item.snapshot_key, review_note: reviewNote }))} disabled={busy || reviewNote.trim().length < 10}>差し戻す</button>
          <button className="approve" onClick={() => void run(() => api.reviewDiagnosticProblemCalibration(item.content_id, pending.id, { status: "approved", expected_snapshot_key: item.snapshot_key, review_note: reviewNote }))} disabled={busy || reviewNote.trim().length < 10}>90日間承認</button>
        </div>
      </> : <small>提案者と異なる管理者の審査を待っています。</small>}
    </div> : item.status !== "collecting" && !activeMasteryIsCurrent ? <div className="diagnostic-calibration-proposal">
      <label><span>校正判断の理由</span><textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={2} maxLength={1000} placeholder="難度・得点分散・識別相関を踏まえた運用判断を記録" /></label>
      <div className="diagnostic-calibration-actions">
        <button onClick={() => void run(() => api.proposeDiagnosticProblemCalibration(item.content_id, { decision: "monitor_only", rationale, expected_snapshot_key: item.snapshot_key }))} disabled={busy || rationale.trim().length < 20}>観測のみを提案</button>
        {item.status === "healthy" ? <button className="approve" onClick={() => void run(() => api.proposeDiagnosticProblemCalibration(item.content_id, { decision: "mastery_enabled", rationale, expected_snapshot_key: item.snapshot_key }))} disabled={busy || rationale.trim().length < 20}>習熟度反映を提案</button> : null}
      </div>
    </div> : null}
    {error ? <p className="form-status error" role="alert">{error}</p> : null}
  </div>;
}

function ModelHealthDashboard({ health, user, busy, error, onReload }: { health: ModelHealth; user: User; busy: boolean; error: string | null; onReload: () => Promise<void> }) {
  const decisionLabel = {
    collecting: "観測を収集中",
    healthy: "継続可能",
    watch: "要監視",
    halt_candidate: "停止候補",
  }[health.decision];
  const dimensionLabels = { mode: "推薦モード", confidence: "信頼度", experience: "学習履歴量" } as const;

  return (
    <section className="model-health-page">
      <header className="model-health-hero">
        <div><span className="dashboard-eyebrow">MODEL QUALITY CONTROL</span><h1>モデル監視</h1><p>個人化予測をシャドーベースラインと比較し、拡大・保留・停止の判断材料を示します。</p></div>
        <button onClick={() => void onReload()} disabled={busy}><RefreshCw className={busy ? "spinning" : ""} />{busy ? "更新中" : "最新に更新"}</button>
      </header>
      {error ? <p className="form-status error" role="alert">{error}</p> : null}

      <section className={`panel model-decision ${health.decision}`}>
        <ShieldAlert />
        <div><span>運営判断</span><strong>{decisionLabel}</strong><p>{health.decision_message}</p></div>
        <small>{health.model_version}</small>
      </section>

      <div className="model-health-kpis">
        <HealthMetric icon={<Eye />} label="推薦表示" value={`${health.overview.exposures}件`} detail={`結果結合率 ${percent(health.overview.observation_rate)}`} />
        <HealthMetric icon={<Activity />} label="評価可能" value={`${health.overview.observed}件`} detail={`${health.overview.minimum_samples}件・${health.overview.minimum_users}人で一次判定`} />
        <HealthMetric icon={<UsersRound />} label="評価ユーザー" value={`${health.overview.evaluated_users}人`} detail={health.overview.truncated ? `${health.overview.analyzed_observations}件を分析` : "直近365日"} />
        <HealthMetric icon={<Gauge />} label="誤差改善" value={health.overview.mae_improvement === null ? "—" : `${health.overview.mae_improvement >= 0 ? "+" : ""}${health.overview.mae_improvement.toFixed(3)}`} detail={`勝率 ${percent(health.overview.win_rate)}`} />
      </div>

      <section className="panel model-hypotheses">
        <div className="model-health-title"><FlaskConical /><div><h2>仮説の検証状況</h2><p>標本条件を満たすまで採択・棄却を保留します。</p></div></div>
        <div>
          {health.hypotheses.map((hypothesis) => (
            <article key={hypothesis.id} className={hypothesis.status}>
              <span>{hypothesis.status === "collecting" ? "収集中" : hypothesis.status === "supported" ? "支持" : hypothesis.status === "rejected" ? "棄却" : "中立"}</span>
              <strong>{hypothesis.label}</strong>
              <small>{hypothesis.evidence}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel shadow-experiments">
        <div className="model-health-title"><Gauge /><div><h2>シャドー候補比較</h2><p>表示順位は現行のまま、同じ解答結果で候補モデルを対比較します。</p></div></div>
        <div className="shadow-experiment-grid">
          {health.shadow_candidates.map((candidate) => (
            <article key={candidate.candidate_version} className={candidate.status}>
              <header>
                <div><span>{candidate.status === "collecting" ? "収集中" : candidate.status === "supported" ? "採択候補" : candidate.status === "rejected" ? "棄却候補" : "中立"}</span><strong>{candidate.label}</strong></div>
                <small>{candidate.samples}件 / {candidate.users}人</small>
              </header>
              <dl>
                <div><dt>候補MAE</dt><dd>{decimal(candidate.candidate_mae)}</dd></div>
                <div><dt>現行MAE</dt><dd>{decimal(candidate.current_mae)}</dd></div>
                <div><dt>MAE改善</dt><dd>{candidate.mae_improvement === null ? "—" : `${candidate.mae_improvement >= 0 ? "+" : ""}${candidate.mae_improvement.toFixed(3)}`}</dd></div>
                <div><dt>Brier改善</dt><dd>{candidate.brier_improvement === null ? "—" : `${candidate.brier_improvement >= 0 ? "+" : ""}${candidate.brier_improvement.toFixed(3)}`}</dd></div>
              </dl>
              {candidate.status === "collecting" ? <p>{candidate.minimum_samples}件・{candidate.minimum_users}人まで指標を非表示にします。</p> : null}
              <small className="shadow-version">{candidate.candidate_version}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel recommendation-effectiveness">
        <div className="model-health-title"><ListOrdered /><div><h2>推薦の行動有効性</h2><p>表示から7日経過した推薦だけで、実際の演習への接続を測ります。</p></div></div>
        <div className="effectiveness-overview">
          <article><small>成熟済み表示</small><strong>{health.recommendation_effectiveness.mature_exposures}件</strong><span>{health.recommendation_effectiveness.users}人</span></article>
          <article><small>7日以内演習率</small><strong>{percent(health.recommendation_effectiveness.conversion_rate_7d)}</strong><span>{health.recommendation_effectiveness.attempted_7d === null ? `${health.recommendation_effectiveness.minimum_exposures}件・${health.recommendation_effectiveness.minimum_users}人で表示` : `${health.recommendation_effectiveness.attempted_7d}件が演習へ接続`}</span></article>
          <article><small>着手時間の中央値</small><strong>{health.recommendation_effectiveness.median_latency_hours === null ? "—" : `${health.recommendation_effectiveness.median_latency_hours}時間`}</strong><span><Clock3 />表示から初回演習まで</span></article>
        </div>
        <div className="rank-band-grid">
          {health.recommendation_effectiveness.rank_bands.map((band) => (
            <article key={band.id}>
              <header><strong>{band.label}</strong><small>{band.exposures}件 / {band.users}人</small></header>
              <div><span>7日以内演習率</span><strong>{percent(band.conversion_rate_7d)}</strong></div>
              <small>{band.attempted_7d === null ? "50件・5人まで指標を非表示" : `${band.attempted_7d}件が演習へ接続`}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel strategy-effectiveness">
        <div className="model-health-title"><FlaskConical /><div><h2>個人戦略の効果</h2><p>本人が採用した戦略について、直前3問と採用後3問の達成度を比較します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>完了した検証</small><strong>{health.strategy_effectiveness.completed_experiments}件</strong><span>{health.strategy_effectiveness.users}人</span></article>
          <article><small>平均達成度変化</small><strong>{health.strategy_effectiveness.average_uplift === null ? "—" : `${health.strategy_effectiveness.average_uplift >= 0 ? "+" : ""}${Math.round(health.strategy_effectiveness.average_uplift * 100)}pt`}</strong><span>{health.strategy_effectiveness.average_uplift === null ? `${health.strategy_effectiveness.minimum_experiments}件・${health.strategy_effectiveness.minimum_users}人で表示` : "採用前3問との比較"}</span></article>
          <article><small>改善した割合</small><strong>{percent(health.strategy_effectiveness.improvement_rate)}</strong><span>達成度が上がった検証</span></article>
        </div>
        <div className="strategy-mode-grid">
          {health.strategy_effectiveness.by_mode.map((mode) => (
            <article key={mode.mode} className={mode.status}>
              <header><strong>{mode.label}</strong><span>{mode.status === "collecting" ? "収集中" : mode.status === "supported" ? "改善" : mode.status === "rejected" ? "低下" : "中立"}</span></header>
              <div><small>{mode.experiments}件 / {mode.users}人</small><strong>{mode.average_uplift === null ? "—" : `${mode.average_uplift >= 0 ? "+" : ""}${Math.round(mode.average_uplift * 100)}pt`}</strong></div>
              <small>{mode.average_uplift === null ? "10件・5人まで効果量を非表示" : "平均達成度変化"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className={`panel schedule-adaptation-health ${health.schedule_adaptation_effectiveness.status}`}>
        <div className="model-health-title"><CalendarDays /><div><h2>学習日程の再配分効果</h2><p>本人が採用した日数再配分について、採用前と14日後の予定日完了率を比較します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>完了した検証</small><strong>{health.schedule_adaptation_effectiveness.completed_experiments}件</strong><span>{health.schedule_adaptation_effectiveness.users}人</span></article>
          <article><small>平均遵守変化</small><strong>{health.schedule_adaptation_effectiveness.average_adherence_uplift === null ? "—" : `${health.schedule_adaptation_effectiveness.average_adherence_uplift >= 0 ? "+" : ""}${Math.round(health.schedule_adaptation_effectiveness.average_adherence_uplift * 100)}pt`}</strong><span>{health.schedule_adaptation_effectiveness.average_adherence_uplift === null ? `${health.schedule_adaptation_effectiveness.minimum_experiments}件・${health.schedule_adaptation_effectiveness.minimum_users}人で表示` : "採用前との本人内比較"}</span></article>
          <article><small>改善した割合</small><strong>{percent(health.schedule_adaptation_effectiveness.improvement_rate)}</strong><span>遵守率が上がった検証</span></article>
        </div>
        <small className="schedule-adaptation-health-note">本人が明示的に採用した提案だけを集計します。ランダム化比較ではないため、因果効果ではなく次の改善仮説として扱います。</small>
      </section>

      <section className={`panel plan-focus-health ${health.plan_focus_effectiveness.status}`}>
        <div className="model-health-title"><Target /><div><h2>ボトルネック重点配分の効果</h2><p>本人が採用した最大50%の重点配分を、14日後の習熟・遵守・範囲カバーで評価します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>完了した検証</small><strong>{health.plan_focus_effectiveness.completed_experiments}件</strong><span>{health.plan_focus_effectiveness.users}人</span></article>
          <article><small>重点習熟の平均変化</small><strong>{health.plan_focus_effectiveness.average_focus_mastery_uplift === null ? "—" : `${health.plan_focus_effectiveness.average_focus_mastery_uplift >= 0 ? "+" : ""}${Math.round(health.plan_focus_effectiveness.average_focus_mastery_uplift * 100)}pt`}</strong><span>{health.plan_focus_effectiveness.average_focus_mastery_uplift === null ? `${health.plan_focus_effectiveness.minimum_experiments}件・${health.plan_focus_effectiveness.minimum_users}人で表示` : `改善率 ${percent(health.plan_focus_effectiveness.improvement_rate)}`}</span></article>
          <article><small>遵守 / 範囲</small><strong>{health.plan_focus_effectiveness.average_adherence_uplift === null ? "—" : `${health.plan_focus_effectiveness.average_adherence_uplift >= 0 ? "+" : ""}${Math.round(health.plan_focus_effectiveness.average_adherence_uplift * 100)}pt`}</strong><span>範囲カバー {percent(health.plan_focus_effectiveness.average_coverage_rate)}</span></article>
        </div>
        <small className="schedule-adaptation-health-note">支持条件は、重点習熟 +5pt以上、計画遵守 -5pt以内、範囲カバー70%以上です。ランダム化比較ではないため因果効果とは断定しません。</small>
      </section>

      <section className={`panel information-gain-health ${health.information_gain_effectiveness.status}`}>
        <div className="model-health-title"><Eye /><div><h2>未知分野の情報獲得</h2><p>本人が採用した最大20%の確認枠で、14日以内に実測証拠が得られたかを評価します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>完了した検証</small><strong>{health.information_gain_effectiveness.completed_experiments}件</strong><span>{health.information_gain_effectiveness.users}人</span></article>
          <article><small>情報獲得率</small><strong>{percent(health.information_gain_effectiveness.acquisition_rate)}</strong><span>{health.information_gain_effectiveness.acquisition_rate === null ? `${health.information_gain_effectiveness.minimum_experiments}件・${health.information_gain_effectiveness.minimum_users}人で表示` : `取得中央値 ${health.information_gain_effectiveness.median_evidence_latency_hours === null ? "—" : `${Math.round(health.information_gain_effectiveness.median_evidence_latency_hours)}時間`}`}</span></article>
          <article><small>遵守 / 範囲</small><strong>{percent(health.information_gain_effectiveness.average_plan_adherence)}</strong><span>範囲カバー {percent(health.information_gain_effectiveness.average_coverage_rate)}</span></article>
        </div>
        <small className="schedule-adaptation-health-note">支持条件は情報獲得率60%以上、計画遵守60%以上、範囲カバー70%以上です。これは確認枠の行動有効性であり、習熟への因果効果ではありません。</small>
      </section>

      <section className={`panel diagnostic-item-health ${health.diagnostic_item_effectiveness.status}`}>
        <div className="model-health-title"><Gauge /><div><h2>確認問題ランキングの実測効率</h2><p>情報量で選んだ1問が、14日以内にどれだけ直接証拠を増やしたかを所要時間込みで評価します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>成熟した提示</small><strong>{health.diagnostic_item_effectiveness.mature_exposures}件</strong><span>{health.diagnostic_item_effectiveness.users}人</span></article>
          <article><small>30分当たり直接証拠</small><strong>{health.diagnostic_item_effectiveness.evidence_per_30_minutes === null ? "—" : health.diagnostic_item_effectiveness.evidence_per_30_minutes.toFixed(2)}</strong><span>{health.diagnostic_item_effectiveness.evidence_per_30_minutes === null ? `${health.diagnostic_item_effectiveness.minimum_exposures}件・${health.diagnostic_item_effectiveness.minimum_users}人で表示` : `14日完了率 ${percent(health.diagnostic_item_effectiveness.completion_rate_14d)}`}</span></article>
          <article><small>時間超過 / 代理差</small><strong>{percent(health.diagnostic_item_effectiveness.time_overrun_rate)}</strong><span>従来候補比 {health.diagnostic_item_effectiveness.average_proxy_advantage === null ? "—" : `${health.diagnostic_item_effectiveness.average_proxy_advantage >= 0 ? "+" : ""}${Math.round(health.diagnostic_item_effectiveness.average_proxy_advantage * 100)}pt`}</span></article>
        </div>
        <small className="schedule-adaptation-health-note">支持条件は30分当たり直接証拠1件以上、14日完了率60%以上、時間超過率35%以下です。従来候補との差はシャドー代理値で、因果効果とは扱いません。</small>
      </section>

      <section className={`panel diagnostic-choice-health ${health.diagnostic_choice_effectiveness.status}`}>
        <div className="model-health-title"><ListOrdered /><div><h2>確認問題の候補充足度</h2><p>意味のある効用差を持つ比較候補が2問以上ある提示だけを、ランキング適用機会として評価します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>成熟した提示</small><strong>{health.diagnostic_choice_effectiveness.mature_exposures}件</strong><span>{health.diagnostic_choice_effectiveness.users}人</span></article>
          <article><small>比較機会率</small><strong>{percent(health.diagnostic_choice_effectiveness.opportunity_rate)}</strong><span>{health.diagnostic_choice_effectiveness.opportunity_rate === null ? `${health.diagnostic_choice_effectiveness.minimum_exposures}件・${health.diagnostic_choice_effectiveness.minimum_users}人で表示` : `${health.diagnostic_choice_effectiveness.comparison_opportunities}件 / ${health.diagnostic_choice_effectiveness.opportunity_users}人`}</span></article>
          <article><small>選定変更 / 代理差</small><strong>{percent(health.diagnostic_choice_effectiveness.rerank_rate)}</strong><span>平均候補 {health.diagnostic_choice_effectiveness.average_comparable_candidates === null ? "—" : health.diagnostic_choice_effectiveness.average_comparable_candidates.toFixed(1)}問・代理差 {health.diagnostic_choice_effectiveness.average_proxy_advantage === null ? "—" : `${health.diagnostic_choice_effectiveness.average_proxy_advantage >= 0 ? "+" : ""}${Math.round(health.diagnostic_choice_effectiveness.average_proxy_advantage * 100)}pt`}</span></article>
        </div>
        <small className="schedule-adaptation-health-note">比較候補が不足する場合は従来候補を維持します。支持条件の50%は候補整備の暫定運用基準で、ランキングの因果効果を示すものではありません。</small>
      </section>

      <section className={`panel diagnostic-content-coverage ${health.diagnostic_content_coverage.status}`}>
        <div className="model-health-title"><ListOrdered /><div><h2>診断コンテンツの充足度</h2><p>アクティブな各学習ノードに、直接測定できる公開済み問題が2問以上あるかを監査します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>診断準備済み</small><strong>{health.diagnostic_content_coverage.ready_nodes} / {health.diagnostic_content_coverage.total_nodes}</strong><span>充足率 {percent(health.diagnostic_content_coverage.ready_rate)}・目標 {percent(health.diagnostic_content_coverage.target_ready_rate)}</span></article>
          <article><small>概念マッピング</small><strong>{percent(health.diagnostic_content_coverage.mapped_node_rate)}</strong><span>{health.diagnostic_content_coverage.mapped_nodes} / {health.diagnostic_content_coverage.total_nodes}ノード</span></article>
          <article><small>候補不足</small><strong>{health.diagnostic_content_coverage.zero_candidate_nodes + health.diagnostic_content_coverage.single_candidate_nodes}ノード</strong><span>0問 {health.diagnostic_content_coverage.zero_candidate_nodes}・1問 {health.diagnostic_content_coverage.single_candidate_nodes}</span></article>
        </div>
        <div className="diagnostic-content-subjects" aria-label="科目別の診断問題充足率">
          {health.diagnostic_content_coverage.by_subject.map((subject) => (
            <article key={subject.subject_key}>
              <header><strong>{subject.topic}</strong><span>{percent(subject.ready_rate)}</span></header>
              <div><span style={{ width: `${subject.ready_rate * 100}%` }} /></div>
              <small>準備済み {subject.ready_nodes}/{subject.nodes}・概念接続 {subject.mapped_nodes}/{subject.nodes}</small>
            </article>
          ))}
        </div>
        {health.diagnostic_content_coverage.priority_gaps.length === 0 ? (
          <p className="diagnostic-content-ready">すべてのアクティブノードで直接測定問題を2問以上確保しています。</p>
        ) : (
          <div className="diagnostic-content-gaps" role="table" aria-label="優先して補う診断コンテンツ">
            <div className="diagnostic-content-gap-head" role="row"><span>科目・ノード</span><span>状態</span><span>問題</span><span>次の作業</span></div>
            {health.diagnostic_content_coverage.priority_gaps.map((gap) => (
              <div key={gap.graph_node_id} className={gap.gap_type} role="row">
                <span><strong>{gap.node_label}</strong><small>{gap.topic}・{CONTENT_NODE_TYPE_LABELS[gap.node_type]}</small></span>
                <span><strong>{CONTENT_GAP_LABELS[gap.gap_type]}</strong><small>概念 {gap.mapped_concept_count}</small></span>
                <span><strong>{gap.direct_problem_count}問</strong><small>関連候補 {gap.eligible_problem_count}</small></span>
                <span>{gap.action}</span>
              </div>
            ))}
          </div>
        )}
        <small className="schedule-adaptation-health-note">レビュー済み問題、承認済みtestsエッジ、有効な公開元をすべて満たす問題だけを数えます。80%は診断ランキングを運用するための暫定コンテンツ基準です。</small>
      </section>

      <section className="panel diagnostic-problem-validity">
        <div className="model-health-title"><ShieldAlert /><div><h2>オリジナル問題の実証的妥当性</h2><p>各受験者の最新答案を、同じ概念に対する過去180日の事前成績と照合し、難度と識別力を監視します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>承認済み問題</small><strong>{health.diagnostic_problem_validity.summary.approved_items}問</strong><span>判定可能 {health.diagnostic_problem_validity.summary.healthy_items + health.diagnostic_problem_validity.summary.watch_items + health.diagnostic_problem_validity.summary.halt_candidate_items}問</span></article>
          <article><small>健全 / 要監視</small><strong>{health.diagnostic_problem_validity.summary.healthy_items} / {health.diagnostic_problem_validity.summary.watch_items}</strong><span>収集中 {health.diagnostic_problem_validity.summary.collecting_items}問</span></article>
          <article><small>停止候補</small><strong>{health.diagnostic_problem_validity.summary.halt_candidate_items}問</strong><span>{health.diagnostic_problem_validity.summary.stable_halt_users}人・事前成績{health.diagnostic_problem_validity.summary.stable_halt_paired_users}人から判定</span></article>
        </div>
        {health.diagnostic_problem_validity.items.length === 0 ? <p className="model-health-empty">承認済みオリジナル問題が問題化されると、受験データの監視を開始します。</p> : <div className="diagnostic-problem-validity-items">
          {health.diagnostic_problem_validity.items.map((item) => <article key={item.content_id} className={item.status}>
            <header><div><strong>{item.problem_label}</strong><small>難度 {item.difficulty}・目標得点 {percent(item.target_score)}</small></div><span>{item.status === "collecting" ? "収集中" : item.status === "healthy" ? "健全" : item.status === "watch" ? "要監視" : "停止候補"}</span></header>
            <dl><div><dt>受験者</dt><dd>{item.users}人</dd></div><div><dt>平均得点</dt><dd>{percent(item.mean_score)}</dd></div><div><dt>得点分散</dt><dd>{decimal(item.score_stddev)}</dd></div><div><dt>識別相関</dt><dd>{decimal(item.anchor_correlation)}</dd></div></dl>
            {item.reasons.length > 0 ? <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>設計難度、得点分散、識別相関が暫定基準内です。</p>}
            <small>同一概念の事前成績あり {item.paired_users}人 / {health.diagnostic_problem_validity.model_version}</small>
            <CalibrationControls item={item} user={user} onChanged={onReload} />
          </article>)}
        </div>}
        <small className="schedule-adaptation-health-note">一次判定は{health.diagnostic_problem_validity.summary.minimum_users}人・事前成績{health.diagnostic_problem_validity.summary.minimum_paired_users}人からです。停止候補はより大きな標本だけで提示し、自動停止や自動廃止は行いません。</small>
      </section>

      <section className={`panel mastery-shadow-health ${health.mastery_shadow.status}`}>
        <div className="model-health-title"><FlaskConical /><div><h2>習熟度の難度補正シャドー比較</h2><p>現行推定は変えず、別問題を1〜30日後に解いた組だけで難度補正候補を照合します。</p></div></div>
        <div className="strategy-effectiveness-overview">
          <article><small>将来答案ペア</small><strong>{health.mastery_shadow.pairs}組</strong><span>{health.mastery_shadow.users}人</span></article>
          <article><small>現行 / 候補 MAE</small><strong>{decimal(health.mastery_shadow.current_mae)} / {decimal(health.mastery_shadow.candidate_mae)}</strong><span>{health.mastery_shadow.current_mae === null ? `${health.mastery_shadow.minimum_pairs}組・${health.mastery_shadow.minimum_users}人で表示` : "小さいほど予測が正確"}</span></article>
          <article><small>MAE改善</small><strong>{health.mastery_shadow.mae_improvement === null ? "—" : `${health.mastery_shadow.mae_improvement >= 0 ? "+" : ""}${health.mastery_shadow.mae_improvement.toFixed(3)}`}</strong><span>{health.mastery_shadow.model_version}</span></article>
        </div>
        <small className="schedule-adaptation-health-note">同じ問題の再挑戦と24時間未満の答案は正解値に使いません。50組・5人までは候補を採択せず、利用者の習熟度や推薦順位も変更しません。</small>
      </section>

      <section className="panel readiness-effectiveness">
        <div className="model-health-title"><Target /><div><h2>目標準備度モデルの検証</h2><p>週1点へ間引いた準備度と、約28日後の目標分野習熟度を本人内で照合します。</p></div></div>
        <div className="readiness-health-overview">
          <article><small>28日ペア</small><strong>{health.readiness_effectiveness.paired_snapshots}組</strong><span>{health.readiness_effectiveness.users}人</span></article>
          <article><small>準備度MAE</small><strong>{decimal(health.readiness_effectiveness.forecast_mae)}</strong><span>{health.readiness_effectiveness.forecast_mae === null ? `${health.readiness_effectiveness.minimum_pairs}組・${health.readiness_effectiveness.minimum_users}人で表示` : `習熟度のみ ${decimal(health.readiness_effectiveness.knowledge_only_mae)}`}</span></article>
          <article><small>基準比MAE改善</small><strong>{health.readiness_effectiveness.mae_improvement === null ? "—" : `${health.readiness_effectiveness.mae_improvement >= 0 ? "+" : ""}${health.readiness_effectiveness.mae_improvement.toFixed(3)}`}</strong><span>正なら複合準備度が有効</span></article>
        </div>
        <div className="readiness-health-detail">
          <article className="adherence-association">
            <header><TrendingUp /><div><strong>計画遵守と28日成長の関連</strong><small>因果効果ではなく観測上の関連です。</small></div></header>
            <div>
              <dl><div><dt>高遵守</dt><dd>{health.readiness_effectiveness.adherence_association.high_average_gain === null ? "—" : `${health.readiness_effectiveness.adherence_association.high_average_gain >= 0 ? "+" : ""}${Math.round(health.readiness_effectiveness.adherence_association.high_average_gain * 100)}pt`}</dd></div><div><dt>低遵守</dt><dd>{health.readiness_effectiveness.adherence_association.low_average_gain === null ? "—" : `${health.readiness_effectiveness.adherence_association.low_average_gain >= 0 ? "+" : ""}${Math.round(health.readiness_effectiveness.adherence_association.low_average_gain * 100)}pt`}</dd></div><div><dt>変化差</dt><dd>{health.readiness_effectiveness.adherence_association.gain_gap === null ? "—" : `${health.readiness_effectiveness.adherence_association.gain_gap >= 0 ? "+" : ""}${Math.round(health.readiness_effectiveness.adherence_association.gain_gap * 100)}pt`}</dd></div></dl>
              <small>高遵守 {health.readiness_effectiveness.adherence_association.high_pairs}組・{health.readiness_effectiveness.adherence_association.high_users}人 / 低遵守 {health.readiness_effectiveness.adherence_association.low_pairs}組・{health.readiness_effectiveness.adherence_association.low_users}人</small>
            </div>
          </article>
          <div className="readiness-band-grid">
            {health.readiness_effectiveness.bands.map((band) => (
              <article key={band.id}>
                <header><strong>{band.label}</strong><small>{band.pairs}組 / {band.users}人</small></header>
                <dl><div><dt>予測</dt><dd>{percent(band.predicted_readiness)}</dd></div><div><dt>28日後</dt><dd>{percent(band.observed_knowledge)}</dd></div><div><dt>ずれ</dt><dd>{band.calibration_gap === null ? "—" : `${band.calibration_gap >= 0 ? "+" : ""}${Math.round(band.calibration_gap * 100)}pt`}</dd></div></dl>
                <small>{band.observed_knowledge === null ? "20組・5人まで指標を非表示" : "目標分野の保守的習熟度"}</small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="model-health-grid">
        <section className="panel model-trends">
          <div className="model-health-title"><Activity /><div><h2>週次予測誤差</h2><p>MAEは小さいほど良い値です。</p></div></div>
          {health.trends.length === 0 ? <p className="model-health-empty">観測結果が蓄積されると、直近12週間の比較を表示します。</p> : (
            <div className="model-trend-table" role="table" aria-label="週次予測誤差">
              <div className="model-trend-head" role="row"><span>週</span><span>件数</span><span>個人化</span><span>基準</span></div>
              {health.trends.map((trend) => <div key={trend.week_start} role="row"><span>{new Date(`${trend.week_start}T00:00:00Z`).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}〜</span><span>{trend.samples}</span><span>{trend.personalized_mae.toFixed(3)}</span><span>{trend.baseline_mae.toFixed(3)}</span></div>)}
            </div>
          )}
        </section>

        <section className="panel model-segments">
          <div className="model-health-title"><UsersRound /><div><h2>セグメント監査</h2><p>20観測・5ユーザー未満は表示しません。</p></div></div>
          {health.segments.length === 0 ? <p className="model-health-empty">安全に集約できるセグメントはまだありません。</p> : (
            <div>{health.segments.map((segment) => <article key={segment.id} className={segment.status}><div><small>{dimensionLabels[segment.dimension]}</small><strong>{segment.label}</strong></div><dl><div><dt>標本</dt><dd>{segment.samples}件 / {segment.users}人</dd></div><div><dt>個人化MAE</dt><dd>{decimal(segment.personalized_mae)}</dd></div><div><dt>改善</dt><dd>{segment.mae_improvement >= 0 ? "+" : ""}{segment.mae_improvement.toFixed(3)}</dd></div></dl></article>)}</div>
          )}
          {health.suppressed_segments > 0 ? <small className="segment-suppressed">小規模な{health.suppressed_segments}セグメントをプライバシー保護のため非表示</small> : null}
        </section>
      </div>

      <footer className="model-health-footer">更新 {new Date(health.generated_at).toLocaleString("ja-JP")} / 自由入力属性・個人別結果はこの画面へ返しません。</footer>
    </section>
  );
}

function HealthMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}
