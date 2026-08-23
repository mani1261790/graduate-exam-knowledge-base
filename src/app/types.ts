export interface User {
  id: string;
  display_name: string;
  email: string;
  department: string | null;
  role: "member" | "editor" | "reviewer" | "admin";
}

export interface Concept {
  id: string;
  slug: string;
  name_ja: string;
  concept_type: string;
  mastery_score?: number | null;
  problem_count?: number;
}

export interface Problem {
  id: string;
  problem_label: string;
  statement_text: string | null;
  university: string;
  graduate_school: string | null;
  department: string | null;
  exam_year: number;
  subject_raw: string | null;
  difficulty: number;
  estimated_minutes: number;
  answer_format: string;
  status: string;
  answer_text: string | null;
  explanation_text: string | null;
  completed: boolean;
  page_start?: number | null;
  page_end?: number | null;
  source_url?: string | null;
  publisher_page_url?: string | null;
  pdf_display_mode?: "embed" | "external_only";
  source_status?: "active" | "unavailable" | "needs_review";
  governed_original?: boolean;
  concepts: Concept[];
}

export interface ProblemDetail extends Problem {
  source_title: string;
  source_url?: string | null;
  access_scope: string;
  similar: Array<{
    id: string;
    problem_label: string;
    statement_text: string | null;
    university: string;
    exam_year: number;
    difficulty: number;
    score: number;
  }>;
  attempts: Array<{
    id: string;
    score_rate: number;
    result: string;
    time_spent_minutes: number | null;
    note: string | null;
    used_hint: number;
    looked_solution: number;
    self_confidence: number | null;
    created_at: string;
  }>;
}

export interface Recommendation extends Problem {
  score: number;
  reasons: string[];
}

export interface SourceDocument {
  id: string;
  source_type: string;
  title: string;
  university: string;
  graduate_school: string | null;
  department: string | null;
  exam_year: number;
  exam_category: string | null;
  source_url: string | null;
  publisher_page_url: string | null;
  file_hash: string;
  storage_path: string;
  access_scope: string;
  pdf_display_mode: "embed" | "external_only";
  source_status: "active" | "unavailable" | "needs_review";
  source_checked_at: string | null;
  extraction_status: string;
  created_at: string;
  problem_count: number;
}

export interface LearningGraphSubject {
  subject_key: string;
  topic: string;
  source_repository: string;
  source_commit: string;
  activated_at: string | null;
}

export interface SourceStats {
  total: number;
  byUniversity: Array<{ university: string; count: number }>;
  byScope: Array<{ access_scope: string; count: number }>;
  byStatus: Array<{ source_status: SourceDocument["source_status"]; count: number }>;
  byDisplay: Array<{ pdf_display_mode: SourceDocument["pdf_display_mode"]; count: number }>;
}

export interface StudyGoal {
  id: string;
  goal_text: string;
  subject_key: string;
  target_university: string | null;
  target_graduate_school: string | null;
  target_department: string | null;
  target_date: string | null;
  sessions_per_week: number;
  minutes_per_session: number;
  updated_at: string;
}

export interface StudyPlanNode {
  id: string;
  label: string;
  node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
  layer: number;
  description: string;
  mastery: number;
  evidence_count: number;
  mastery_basis: "prior" | "observed";
  readiness: number;
  status: "completed" | "ready" | "blocked";
  prerequisites: Array<{ id: string; label: string; weight: number; mastery: number }>;
}

export interface StudyPlanItem {
  id: string;
  graph_node_id: string;
  node_label: string;
  problem_id: string | null;
  scheduled_date: string;
  estimated_minutes: number;
  mode: "normal" | "review" | "foundation" | "challenge" | "concept";
  status: "pending" | "completed" | "skipped";
  superseded_at: string | null;
  superseded_reason: "overdue_replanned" | null;
  reason: string;
  problem?: Problem;
  concepts?: Array<Pick<Concept, "id" | "slug" | "name_ja" | "concept_type" | "problem_count">>;
}

export interface StudyPlanResponse {
  plan: {
    id: string;
    topic: string;
    subject_key: string;
    goal_text: string;
    target_date: string | null;
    sessions_per_week: number;
    minutes_per_session: number;
    source_repository: string;
    source_commit: string;
  };
  nodes: StudyPlanNode[];
  items: StudyPlanItem[];
  today: StudyPlanItem[];
}

export interface ProblemChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PersonalAnalytics {
  model: {
    version: string;
    generated_at: string;
    window_days: number;
    analyzed_attempts: number;
    available_attempts: number;
    truncated: boolean;
    hypotheses: Array<{ id: string; label: string; metric: string }>;
  };
  summary: {
    total_attempts: number;
    active_days: number;
    total_minutes: number;
    average_score: number | null;
    success_rate: number | null;
    pace_score: number | null;
    calibration_score: number | null;
    current_streak_days: number;
    evidence_strength: number;
  };
  calibration: {
    status: "insufficient" | "well_calibrated" | "overconfident" | "underconfident";
    sample_count: number;
    mean_confidence: number | null;
    mean_score: number | null;
    gap: number | null;
    message: string;
  };
  model_quality: {
    status: "insufficient" | "improving" | "neutral" | "regressing";
    sample_count: number;
    minimum_sample_size: number;
    personalized_mae: number | null;
    baseline_mae: number | null;
    mae_improvement: number | null;
    personalized_brier: number | null;
    baseline_brier: number | null;
    win_rate: number | null;
    message: string;
  };
  diagnostics: {
    retention: {
      status: "insufficient" | "improving" | "stable" | "declining";
      sample_pairs: number;
      minimum_pairs: number;
      average_score_change: number | null;
      median_interval_days: number | null;
      message: string;
    };
    independence: {
      status: "insufficient" | "balanced" | "support_dependent" | "independent_strong";
      independent_count: number;
      assisted_count: number;
      minimum_per_group: number;
      independent_score: number | null;
      assisted_score: number | null;
      assisted_gap: number | null;
      message: string;
    };
    pacing: {
      status: "insufficient" | "stable" | "overtime_cost" | "careful_working";
      on_time_count: number;
      overtime_count: number;
      minimum_per_group: number;
      on_time_score: number | null;
      overtime_score: number | null;
      on_time_advantage: number | null;
      message: string;
    };
  };
  strategy: {
    experiment_id: string | null;
    recommended_mode: "normal" | "review" | "foundation" | "challenge";
    confidence: "low" | "medium" | "high";
    title: string;
    rationale: string[];
    action: string;
  };
  strategy_evaluation: {
    experiment_id: string;
    recommended_mode: "normal" | "review" | "foundation" | "challenge";
    status: "in_progress" | "improving" | "neutral" | "regressing";
    matched_attempt_count: number;
    required_attempts: number;
    baseline_score: number | null;
    followup_score: number | null;
    score_uplift: number | null;
    accepted_at: string;
    completed_at: string | null;
    message: string;
  } | null;
  schedule_adaptation: {
    experiment_id: string;
    status: "proposal" | "monitoring" | "improving" | "neutral" | "regressing";
    current_sessions_per_week: number;
    current_minutes_per_session: number;
    proposed_sessions_per_week: number;
    proposed_minutes_per_session: number;
    weekly_minutes_before: number;
    weekly_minutes_after: number;
    rationale: string;
    baseline_plan_adherence: number;
    baseline_weekly_pace: number;
    baseline_due_sessions: number;
    followup_plan_adherence: number | null;
    followup_weekly_pace: number | null;
    followup_due_sessions: number | null;
    adherence_uplift: number | null;
    accepted_at: string | null;
    completed_at: string | null;
    message: string;
  } | null;
  plan_focus: {
    experiment_id: string;
    status: "proposal" | "monitoring" | "improving" | "neutral" | "regressing";
    focus_node_ids: string[];
    focus_node_labels: string[];
    baseline_distribution: Array<{ node_id: string; label: string; sessions: number }>;
    proposed_distribution: Array<{ node_id: string; label: string; sessions: number }>;
    baseline_focus_mastery: number;
    baseline_distinct_nodes: number;
    proposed_distinct_nodes: number;
    rationale: string;
    baseline_plan_adherence: number;
    baseline_due_sessions: number;
    followup_focus_mastery: number | null;
    focus_mastery_uplift: number | null;
    followup_plan_adherence: number | null;
    adherence_uplift: number | null;
    followup_due_sessions: number | null;
    coverage_rate: number | null;
    accepted_at: string | null;
    completed_at: string | null;
    message: string;
  } | null;
  information_gain: {
    experiment_id: string;
    status: "proposal" | "monitoring" | "evidence_acquired" | "completed" | "no_evidence";
    exploration_node_id: string;
    exploration_node_label: string;
    baseline_evidence_count: number;
    baseline_distribution: Array<{ node_id: string; label: string; sessions: number }>;
    proposed_distribution: Array<{ node_id: string; label: string; sessions: number }>;
    baseline_distinct_nodes: number;
    proposed_distinct_nodes: number;
    exploration_sessions: number;
    rationale: string;
    baseline_plan_adherence: number | null;
    baseline_due_sessions: number;
    evidence_acquired_at: string | null;
    evidence_latency_hours: number | null;
    followup_plan_adherence: number | null;
    followup_due_sessions: number | null;
    coverage_rate: number | null;
    accepted_at: string | null;
    completed_at: string | null;
    message: string;
  } | null;
  diagnostic_item: {
    model_version: "diagnostic-item-v1";
    selected_problem_id: string;
    selected_problem_label: string;
    baseline_problem_id: string;
    selected_utility: number;
    baseline_utility: number;
    target_concept_count: number;
    direct_concept_count: number;
    estimated_minutes: number;
    candidate_problem_count: number;
    comparable_candidate_count: number;
    utility_spread: number;
    ranking_opportunity: boolean;
    selection_changed: boolean;
    observed_direct_evidence_count: number | null;
    observed_total_evidence_gain: number | null;
    observed_time_minutes: number | null;
    completion_latency_hours: number | null;
    observed_at: string | null;
    message: string;
  } | null;
  goal_readiness: {
    model_version: string;
    goal_id: string | null;
    goal_label: string | null;
    target_date: string | null;
    days_remaining: number | null;
    status: "no_goal" | "collecting" | "progressing" | "on_track" | "at_risk" | "target_passed";
    readiness_score: number | null;
    lower_bound: number | null;
    upper_bound: number | null;
    knowledge_readiness: number | null;
    evidence_coverage: number | null;
    target_concepts: number;
    sufficiently_observed_concepts: number;
    plan_adherence: number | null;
    due_plan_sessions: number;
    completed_due_sessions: number;
    overdue_sessions: number;
    upcoming_sessions_7d: number;
    current_weekly_pace: number;
    required_weekly_pace: number;
    pace_attainment: number;
    message: string;
    action: string;
    history: Array<{
      snapshot_date: string;
      readiness_score: number;
      lower_bound: number;
      upper_bound: number;
      status: "no_goal" | "collecting" | "progressing" | "on_track" | "at_risk" | "target_passed";
    }>;
  } | null;
  trends: Array<{ week_start: string; attempts: number; minutes: number; average_score: number | null }>;
  concepts: Array<{
    id: string;
    name_ja: string;
    mastery_score: number;
    evidence_count: number;
    last_attempted_at: string | null;
    review_due_at: string | null;
    confidence: number;
    conservative_mastery: number;
    needs_evidence: boolean;
  }>;
  mastery_evidence: {
    model_version: "mastery-evidence-explain-v1";
    recent: Array<{
      id: string;
      concept_id: string;
      concept_name: string;
      problem_id: string;
      problem_label: string;
      difficulty: number;
      raw_evidence: number;
      previous_mastery: number | null;
      current_prediction: number;
      created_at: string;
    }>;
    concepts: Array<{
      concept_id: string;
      concept_name: string;
      sample_count: number;
      mean_evidence: number;
      evidence_stddev: number | null;
      evidence_range: number | null;
      status: "insufficient" | "stable" | "mixed" | "contradictory";
      message: string;
    }>;
  };
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    body: string;
    action: string;
  }>;
}

export interface DiagnosticRemediationQueue {
  generated_at: string;
  summary: {
    total_nodes: number;
    ready_nodes: number;
    reviewable_nodes: number;
    new_content_nodes: number;
    pending_reviews: number;
    approved_explicit_links: number;
  };
  items: Array<{
    graph_node_id: string;
    subject_key: string;
    topic: string;
    node_label: string;
    node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
    layer: number;
    mapped_concept_count: number;
    current_direct_count: number;
    target_direct_count: 2;
    deficit: number;
    state: "ready" | "review_candidates" | "new_content_required";
    candidates: Array<{
      problem_id: string;
      problem_label: string;
      university: string;
      exam_year: number;
      answer_format: string;
      estimated_minutes: number;
      statement_preview: string;
      source_url: string;
      page_start: number | null;
      page_end: number | null;
      concept_overlap: number;
      concept_names: string;
      label_match: boolean;
      link: null | {
        id: string;
        status: "candidate" | "approved" | "rejected" | "deprecated";
        confidence: number;
        rationale: string;
        created_by: string | null;
        reviewed_by: string | null;
      };
    }>;
  }>;
}

export interface DiagnosticBlueprintInput {
  title: string;
  assessment_objective: string;
  evidence_expectation: string;
  cognitive_demand: "concept_application" | "multi_step_reasoning" | "transfer";
  answer_format: "multiple_choice" | "numeric" | "short_text" | "proof" | "derivation" | "programming" | "essay" | "mixed";
  difficulty: number;
  estimated_minutes: number;
  rubric: Array<{ label: string; weight: number }>;
  misconception_targets: string[];
  originality_policy: "original_only";
}

export interface DiagnosticBlueprintQueue {
  generated_at: string;
  summary: {
    nodes_needing_problems: number;
    not_started_nodes: number;
    drafting_nodes: number;
    review_nodes: number;
    specification_ready_nodes: number;
    pending_blueprints: number;
    approved_blueprints: number;
  };
  items: Array<{
    graph_node_id: string;
    subject_key: string;
    topic: string;
    node_label: string;
    node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
    mapped_concept_count: number;
    current_direct_count: number;
    problem_deficit: number;
    state: "not_started" | "drafting" | "in_review" | "specification_ready";
    specification_ready: boolean;
    pending_review_count: number;
    approved_cognitive_demands: DiagnosticBlueprintInput["cognitive_demand"][];
    blueprints: Array<DiagnosticBlueprintInput & {
      id: string;
      graph_node_id: string;
      slot: number;
      status: "draft" | "candidate" | "approved" | "rejected" | "retired";
      revision: number;
      review_note: string | null;
      created_by: string;
      submitted_by: string | null;
      reviewed_by: string | null;
      submitted_at: string | null;
      reviewed_at: string | null;
      quality_issues: string[];
    }>;
  }>;
}

export interface DiagnosticCriterionScore {
  label: string;
  score: number;
}

export interface DiagnosticScoringExample {
  level: "full_credit" | "partial_credit" | "no_credit";
  response: string;
  score_rate: number;
  criterion_scores: DiagnosticCriterionScore[];
  rationale: string;
}

export interface DiagnosticAdversarialCheck {
  type: "ambiguity" | "answer_leakage" | "misconception_discrimination" | "edge_case";
  finding: string;
  resolution: string;
}

export type DiagnosticVerificationType = "independent_recalculation" | "boundary_case" | "misconception_trap" | "format_compliance";

export interface DiagnosticVerificationCase {
  type: DiagnosticVerificationType;
  instruction: string;
  expected_result: string;
  tolerance: number | null;
}

export interface DiagnosticVerificationResult {
  type: DiagnosticVerificationType;
  observed_result: string;
  passed: boolean;
}

export interface DiagnosticProblemContentInput {
  problem_label: string;
  statement_text: string;
  answer_text: string;
  explanation_text: string;
  scoring_examples: DiagnosticScoringExample[];
  adversarial_checks: DiagnosticAdversarialCheck[];
  verification_cases: DiagnosticVerificationCase[];
  originality_note: string;
}

export interface DiagnosticProblemAuthoringQueue {
  generated_at: string;
  summary: {
    approved_blueprints: number;
    not_started: number;
    drafting: number;
    pending_review: number;
    pending_verification: number;
    verified_pending_approval: number;
    failed_verification: number;
    verification_runs: number;
    verification_pass_rate: number | null;
    approved_content: number;
    materialized_problems: number;
  };
  items: Array<{
    blueprint: {
      id: string;
      graph_node_id: string;
      slot: number;
      title: string;
      assessment_objective: string;
      evidence_expectation: string;
      cognitive_demand: DiagnosticBlueprintInput["cognitive_demand"];
      answer_format: DiagnosticBlueprintInput["answer_format"];
      difficulty: number;
      estimated_minutes: number;
      rubric: DiagnosticBlueprintInput["rubric"];
      misconception_targets: string[];
      status: "approved";
    };
    state: "not_started" | "drafting" | "in_review" | "approved";
    content: null | (DiagnosticProblemContentInput & {
      id: string;
      blueprint_id: string;
      problem_id: string;
      problem_node_id: string;
      graph_problem_link_id: string;
      content_fingerprint: string | null;
      status: "draft" | "candidate" | "approved" | "rejected" | "retired";
      revision: number;
      review_note: string | null;
      created_by: string;
      submitted_by: string | null;
      reviewed_by: string | null;
      verification_status: "unverified" | "passed" | "failed";
      verification_revision: number | null;
      verified_by: string | null;
      verified_at: string | null;
      submitted_at: string | null;
      reviewed_at: string | null;
      materialized_at: string | null;
      quality_issues: string[];
      verification_runs: Array<{
        id: string;
        content_id: string;
        content_revision: number;
        verifier_id: string;
        outcome: "passed" | "failed";
        contract: DiagnosticVerificationCase[];
        results: DiagnosticVerificationResult[];
        note: string | null;
        created_at: string;
      }>;
    });
  }>;
}

export interface ModelHealth {
  model_version: string;
  generated_at: string;
  decision: "collecting" | "healthy" | "watch" | "halt_candidate";
  decision_message: string;
  overview: {
    exposures: number;
    observed: number;
    analyzed_observations: number;
    truncated: boolean;
    observation_rate: number | null;
    evaluated_users: number;
    personalized_mae: number | null;
    baseline_mae: number | null;
    mae_improvement: number | null;
    win_rate: number | null;
    minimum_samples: number;
    minimum_users: number;
  };
  trends: Array<{ week_start: string; samples: number; personalized_mae: number; baseline_mae: number }>;
  segments: Array<{
    id: string;
    dimension: "mode" | "confidence" | "experience";
    label: string;
    samples: number;
    users: number;
    personalized_mae: number;
    baseline_mae: number;
    mae_improvement: number;
    status: "healthy" | "neutral" | "regressing";
  }>;
  suppressed_segments: number;
  shadow_candidates: Array<{
    candidate_version: string;
    hypothesis_id: string;
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    samples: number;
    users: number;
    minimum_samples: number;
    minimum_users: number;
    candidate_mae: number | null;
    current_mae: number | null;
    mae_improvement: number | null;
    candidate_brier: number | null;
    current_brier: number | null;
    brier_improvement: number | null;
  }>;
  recommendation_effectiveness: {
    mature_exposures: number;
    users: number;
    attempted_7d: number | null;
    conversion_rate_7d: number | null;
    median_latency_hours: number | null;
    minimum_exposures: number;
    minimum_users: number;
    rank_bands: Array<{
      id: "top-3" | "rank-4-10" | "rank-11-20";
      label: string;
      exposures: number;
      users: number;
      attempted_7d: number | null;
      conversion_rate_7d: number | null;
    }>;
  };
  strategy_effectiveness: {
    completed_experiments: number;
    users: number;
    minimum_experiments: number;
    minimum_users: number;
    average_uplift: number | null;
    improvement_rate: number | null;
    by_mode: Array<{
      mode: "normal" | "review" | "foundation" | "challenge";
      label: string;
      experiments: number;
      users: number;
      average_uplift: number | null;
      status: "collecting" | "supported" | "neutral" | "rejected";
    }>;
  };
  readiness_effectiveness: {
    horizon_days: 28;
    paired_snapshots: number;
    users: number;
    minimum_pairs: number;
    minimum_users: number;
    forecast_mae: number | null;
    knowledge_only_mae: number | null;
    mae_improvement: number | null;
    adherence_association: {
      high_pairs: number;
      high_users: number;
      low_pairs: number;
      low_users: number;
      high_average_gain: number | null;
      low_average_gain: number | null;
      gain_gap: number | null;
      minimum_pairs_per_group: number;
      minimum_users_per_group: number;
    };
    bands: Array<{
      id: "low" | "medium" | "high";
      label: string;
      pairs: number;
      users: number;
      predicted_readiness: number | null;
      observed_knowledge: number | null;
      calibration_gap: number | null;
    }>;
    hypotheses: Array<{
      id: "P7_GOAL_READINESS" | "P8_PLAN_ADHERENCE";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    }>;
  };
  schedule_adaptation_effectiveness: {
    completed_experiments: number;
    users: number;
    minimum_experiments: number;
    minimum_users: number;
    average_adherence_uplift: number | null;
    improvement_rate: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P9_SCHEDULE_CONSOLIDATION";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  plan_focus_effectiveness: {
    completed_experiments: number;
    users: number;
    minimum_experiments: number;
    minimum_users: number;
    average_focus_mastery_uplift: number | null;
    average_adherence_uplift: number | null;
    average_coverage_rate: number | null;
    improvement_rate: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P10_BOTTLENECK_FOCUS";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  information_gain_effectiveness: {
    completed_experiments: number;
    users: number;
    minimum_experiments: number;
    minimum_users: number;
    acquisition_rate: number | null;
    median_evidence_latency_hours: number | null;
    average_plan_adherence: number | null;
    average_coverage_rate: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P11_DIAGNOSTIC_EXPLORATION";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  diagnostic_item_effectiveness: {
    mature_exposures: number;
    users: number;
    minimum_exposures: number;
    minimum_users: number;
    completion_rate_14d: number | null;
    evidence_per_30_minutes: number | null;
    time_overrun_rate: number | null;
    average_proxy_advantage: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P12_DIAGNOSTIC_ITEM_VALUE";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  diagnostic_choice_effectiveness: {
    mature_exposures: number;
    users: number;
    minimum_exposures: number;
    minimum_users: number;
    comparison_opportunities: number;
    opportunity_users: number;
    opportunity_rate: number | null;
    average_comparable_candidates: number | null;
    rerank_rate: number | null;
    average_proxy_advantage: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P13_DIAGNOSTIC_CHOICE_COVERAGE";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  diagnostic_content_coverage: {
    active_graphs: number;
    total_nodes: number;
    mapped_nodes: number;
    mapped_node_rate: number | null;
    ready_nodes: number;
    ready_rate: number | null;
    target_ready_rate: 0.8;
    minimum_direct_problems: 2;
    zero_candidate_nodes: number;
    single_candidate_nodes: number;
    by_subject: Array<{
      subject_key: string;
      topic: string;
      nodes: number;
      mapped_nodes: number;
      ready_nodes: number;
      ready_rate: number;
    }>;
    priority_gaps: Array<{
      graph_node_id: string;
      subject_key: string;
      topic: string;
      node_label: string;
      node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
      mapped_concept_count: number;
      direct_problem_count: number;
      eligible_problem_count: number;
      gap_type: "unmapped" | "no_direct_problem" | "single_direct_problem";
      action: string;
    }>;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "P14_DIAGNOSTIC_CONTENT_COVERAGE";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  diagnostic_problem_validity: {
    model_version: string;
    summary: {
      approved_items: number;
      collecting_items: number;
      healthy_items: number;
      watch_items: number;
      halt_candidate_items: number;
      minimum_users: number;
      minimum_paired_users: number;
      stable_halt_users: number;
      stable_halt_paired_users: number;
    };
    items: Array<{
      content_id: string;
      problem_id: string;
      problem_label: string;
      difficulty: number;
      content_revision: number;
      users: number;
      paired_users: number;
      mean_score: number | null;
      score_stddev: number | null;
      anchor_correlation: number | null;
      target_score: number;
      difficulty_deviation: number | null;
      status: "collecting" | "healthy" | "watch" | "halt_candidate";
      reasons: string[];
      snapshot_key: string;
      calibration: {
        active: DiagnosticProblemCalibration | null;
        pending: DiagnosticProblemCalibration | null;
      };
    }>;
    hypothesis: {
      id: "H19_ORIGINAL_ITEMS_ARE_EMPIRICALLY_VALID";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  mastery_shadow: {
    model_version: string;
    pairs: number;
    users: number;
    minimum_pairs: number;
    minimum_users: number;
    current_mae: number | null;
    candidate_mae: number | null;
    mae_improvement: number | null;
    status: "collecting" | "supported" | "neutral" | "rejected";
    hypothesis: {
      id: "H21_DIFFICULTY_ADJUSTMENT_IMPROVES_MASTERY";
      label: string;
      status: "collecting" | "supported" | "neutral" | "rejected";
      evidence: string;
    };
  };
  hypotheses: Array<{
    id: string;
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  }>;
}

export interface DiagnosticProblemCalibration {
  id: string;
  content_id: string;
  content_revision: number;
  validity_model_version: string;
  snapshot_key: string;
  users: number;
  paired_users: number;
  mean_score: number | null;
  score_stddev: number | null;
  anchor_correlation: number | null;
  target_score: number;
  observed_status: "healthy" | "watch" | "halt_candidate";
  decision: "mastery_enabled" | "monitor_only";
  rationale: string;
  status: "candidate" | "approved" | "rejected" | "superseded";
  proposed_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  valid_until: string | null;
}
