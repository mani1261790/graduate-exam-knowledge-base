import { describe, expect, it } from "vitest";
import {
  buildDiagnosticChoiceHealth,
  buildDiagnosticChoicePolicy,
  buildDiagnosticItemHealth,
  diagnosticProblemUtility,
  rankDiagnosticProblems,
  type DiagnosticItemHealthRow,
  type DiagnosticProblemSignal,
} from "../src/worker/diagnostic-items";

function signal(overrides: Partial<DiagnosticProblemSignal> & Pick<DiagnosticProblemSignal, "problem_id">): DiagnosticProblemSignal {
  return {
    problem_label: overrides.problem_id,
    difficulty: 3,
    estimated_minutes: 30,
    target_concept_count: 4,
    direct_concept_count: 1,
    weighted_evidence_potential: 1,
    baseline_node_evidence_count: 0,
    ...overrides,
  };
}

describe("diagnostic item ranking", () => {
  it("prefers a problem that directly measures more uncertain target concepts", () => {
    const ranked = rankDiagnosticProblems([
      signal({ problem_id: "narrow", direct_concept_count: 1, weighted_evidence_potential: 0.8 }),
      signal({ problem_id: "broad", direct_concept_count: 3, weighted_evidence_potential: 2.4 }),
    ]);
    expect(ranked[0].problem_id).toBe("broad");
    expect(ranked[0].utility).toBeGreaterThan(ranked[1].utility);
  });

  it("uses moderate difficulty and time efficiency as bounded tie breakers", () => {
    const moderate = diagnosticProblemUtility(signal({ problem_id: "moderate", difficulty: 3, estimated_minutes: 25 }));
    const extreme = diagnosticProblemUtility(signal({ problem_id: "extreme", difficulty: 5, estimated_minutes: 60 }));
    expect(moderate.utility).toBeGreaterThan(extreme.utility);
    expect(moderate.utility).toBeLessThanOrEqual(1);
  });

  it("does not let a zero target count create an invalid score", () => {
    const ranked = diagnosticProblemUtility(signal({ problem_id: "safe", target_concept_count: 0 }));
    expect(Number.isFinite(ranked.utility)).toBe(true);
    expect(ranked.utility).toBeGreaterThanOrEqual(0);
  });

  it("keeps the baseline when only one comparable candidate exists", () => {
    const ranked = rankDiagnosticProblems([signal({ problem_id: "only", weighted_evidence_potential: 2 })]);
    const policy = buildDiagnosticChoicePolicy(["only"], ranked);
    expect(policy?.selected.problem_id).toBe("only");
    expect(policy?.ranking_opportunity).toBe(false);
    expect(policy?.selection_changed).toBe(false);
  });

  it("changes the selected item only when the utility advantage is meaningful", () => {
    const ranked = rankDiagnosticProblems([
      signal({ problem_id: "baseline", direct_concept_count: 1, weighted_evidence_potential: 0.6 }),
      signal({ problem_id: "better", direct_concept_count: 3, weighted_evidence_potential: 2.6 }),
    ]);
    const policy = buildDiagnosticChoicePolicy(["baseline", "better"], ranked);
    expect(policy?.ranking_opportunity).toBe(true);
    expect(policy?.selection_changed).toBe(true);
    expect(policy?.selected.problem_id).toBe("better");
    expect(policy?.candidate_problem_count).toBe(2);
  });

  it("records a comparison opportunity without changing an already-best baseline", () => {
    const ranked = rankDiagnosticProblems([
      signal({ problem_id: "best", direct_concept_count: 3, weighted_evidence_potential: 2.6 }),
      signal({ problem_id: "lower", direct_concept_count: 1, weighted_evidence_potential: 0.6 }),
    ]);
    const policy = buildDiagnosticChoicePolicy(["best", "lower"], ranked);
    expect(policy?.ranking_opportunity).toBe(true);
    expect(policy?.selection_changed).toBe(false);
    expect(policy?.selected.problem_id).toBe("best");
  });
});

describe("diagnostic item health", () => {
  function rows(input: { count?: number; users?: number; direct?: number; minutes?: number; result?: DiagnosticItemHealthRow["observed_result"] }): DiagnosticItemHealthRow[] {
    return Array.from({ length: input.count ?? 30 }, (_, index) => ({
      user_id: `user_${index % (input.users ?? 10)}`,
      selected_utility: 0.75,
      baseline_utility: 0.6,
      estimated_minutes: 30,
      observed_result: input.result ?? "partial",
      observed_direct_evidence_count: input.direct ?? 2,
      observed_time_minutes: input.minutes ?? 30,
      completion_latency_hours: 24,
      candidate_problem_count: 3,
      comparable_candidate_count: 3,
      utility_spread: 0.2,
      ranking_opportunity: 1,
      selection_changed: 1,
    }));
  }

  it("suppresses metrics until both privacy thresholds are met", () => {
    const health = buildDiagnosticItemHealth(rows({ users: 1 }));
    expect(health.status).toBe("collecting");
    expect(health.evidence_per_30_minutes).toBeNull();
  });

  it("supports efficient diagnostic items when completion and time guardrails hold", () => {
    const health = buildDiagnosticItemHealth(rows({ direct: 2, minutes: 30 }));
    expect(health.status).toBe("supported");
    expect(health.evidence_per_30_minutes).toBe(2);
    expect(health.completion_rate_14d).toBe(1);
  });

  it("rejects a ranking whose selected items are mostly not completed", () => {
    const completed = rows({ count: 9 });
    const skipped = rows({ count: 21, result: "skipped" }).map((row, index) => ({ ...row, user_id: `user_${index % 10}` }));
    expect(buildDiagnosticItemHealth([...completed, ...skipped]).status).toBe("rejected");
  });

  it("rejects evidence gains obtained with excessive time overruns", () => {
    expect(buildDiagnosticItemHealth(rows({ direct: 2, minutes: 60 })).status).toBe("rejected");
  });
});

describe("diagnostic choice coverage health", () => {
  function choiceRows(input: { count?: number; users?: number; opportunities?: number }): DiagnosticItemHealthRow[] {
    const count = input.count ?? 30;
    const opportunities = input.opportunities ?? count;
    return Array.from({ length: count }, (_, index) => ({
      user_id: `user_${index % (input.users ?? 10)}`,
      selected_utility: index < opportunities ? 0.75 : 0.6,
      baseline_utility: 0.6,
      estimated_minutes: 30,
      observed_result: "partial",
      observed_direct_evidence_count: 2,
      observed_time_minutes: 30,
      completion_latency_hours: 24,
      candidate_problem_count: index < opportunities ? 3 : 1,
      comparable_candidate_count: index < opportunities ? 3 : 1,
      utility_spread: index < opportunities ? 0.2 : 0,
      ranking_opportunity: index < opportunities ? 1 : 0,
      selection_changed: index < opportunities ? 1 : 0,
    }));
  }

  it("suppresses candidate coverage rates for a one-user cohort", () => {
    const health = buildDiagnosticChoiceHealth(choiceRows({ users: 1 }));
    expect(health.status).toBe("collecting");
    expect(health.opportunity_rate).toBeNull();
  });

  it("supports candidate coverage when at least half of mature prompts are comparable", () => {
    const health = buildDiagnosticChoiceHealth(choiceRows({ opportunities: 18 }));
    expect(health.status).toBe("supported");
    expect(health.opportunity_rate).toBe(0.6);
    expect(health.rerank_rate).toBe(1);
  });

  it("rejects candidate coverage when fewer than one quarter are comparable", () => {
    const health = buildDiagnosticChoiceHealth(choiceRows({ opportunities: 6 }));
    expect(health.status).toBe("rejected");
    expect(health.opportunity_rate).toBe(0.2);
  });
});
