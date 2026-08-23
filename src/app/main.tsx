import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  BookOpen,
  CircleAlert,
  CheckCircle2,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  Filter,
  GitBranch,
  GraduationCap,
  Home,
  Link2,
  LockKeyhole,
  LogOut,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Concept, LearningGraphSubject, Problem, ProblemDetail, Recommendation, SourceDocument, SourceStats, StudyGoal, StudyPlanResponse, User } from "./types";
import { SolveWorkspacePage } from "./SolveWorkspace";
import { PersonalAnalyticsPage } from "./PersonalAnalyticsView";
import { ModelHealthPage } from "./ModelHealthView";
import { DiagnosticContentAdmin } from "./DiagnosticContentAdmin";
import { DiagnosticBlueprintAdmin } from "./DiagnosticBlueprintAdmin";
import { DiagnosticProblemContentAdmin } from "./DiagnosticProblemContentAdmin";
import "./styles.css";

type View = "home" | "concepts" | "study-plan" | "analytics" | "model-health" | "admin";
type RecommendationMode = "normal" | "review" | "foundation" | "challenge";

function initialView(): View {
  const candidate = new URLSearchParams(window.location.search).get("view");
  return candidate === "concepts" || candidate === "study-plan" || candidate === "analytics" || candidate === "model-health" || candidate === "admin" ? candidate : "home";
}

const STATUS_LABELS: Record<string, string> = {
  reviewed: "確認済み",
  candidate: "確認待ち",
  draft: "下書き",
  duplicate: "重複",
  deprecated: "非表示",
};

const ACCESS_SCOPE_LABELS: Record<string, string> = {
  internal_only: "内部利用",
  source_link_only: "リンク参照",
  public_ready: "公開可",
  restricted: "制限あり",
};

const SOURCE_STATUS_LABELS: Record<SourceDocument["source_status"], string> = {
  active: "公開中",
  needs_review: "確認待ち",
  unavailable: "利用停止",
};

const PDF_DISPLAY_LABELS: Record<SourceDocument["pdf_display_mode"], string> = {
  embed: "サイト内表示",
  external_only: "別タブ表示",
};

function canManageSources(user: User | null): boolean {
  return Boolean(user && user.role !== "member");
}

function canReviewSources(user: User): boolean {
  return user.role === "reviewer" || user.role === "admin";
}

function canMonitorModels(user: User | null): boolean {
  return user?.role === "reviewer" || user?.role === "admin";
}

const SUBJECT_GROUPS = [
  { id: "math", label: "数学基礎", keywords: ["数学", "微分", "積分", "線形", "行列", "確率", "統計", "解析", "代数", "幾何", "位相", "固有", "級数", "関数", "最適化", "数値", "微分方程式", "ラプラス方程式"] },
  { id: "algorithms", label: "アルゴリズム・離散", keywords: ["離散", "アルゴリズム", "グラフ", "探索", "DP", "動的計画", "Union-Find", "計算量", "オートマトン", "形式言語", "データ構造", "ソート", "最短路", "ネットワークフロー"] },
  { id: "systems", label: "計算機システム", keywords: ["計算機", "コンピュータ", "OS", "オペレーティングシステム", "データベース", "アーキテクチャ", "論理回路", "プログラミング", "ソフトウェア", "システム設計", "情報システム", "セキュリティ"] },
  { id: "signals", label: "信号・制御・通信", keywords: ["信号", "フーリエ", "ラプラス変換", "Z変換", "周波数", "フィルタ", "標本化", "サンプリング", "多重解像", "ウェーブレット", "通信", "ネットワーク通信", "OFDM", "制御", "伝達関数", "状態空間", "システム解析", "情報理論", "符号", "暗号", "エントロピー"] },
  { id: "aiData", label: "AI・データ分析", keywords: ["機械学習", "AI", "人工知能", "データ分析", "統計解析", "パターン認識", "画像処理", "回帰", "分類", "ニューラル", "ベイズ", "評価指標"] },
  { id: "science", label: "物理・化学・生命", keywords: ["物理", "力学", "電磁", "量子", "熱", "化学", "有機", "無機", "生命", "生物", "遺伝", "医学", "材料", "光学"] },
  { id: "english", label: "英語・専門読解", keywords: ["英語", "専門英語", "読解", "語彙", "翻訳", "英文", "外国語", "学術英語", "学術読解"] },
  { id: "humanities", label: "人文・社会", keywords: ["社会", "制度", "政策", "経済", "経営", "心理", "教育", "メディア", "倫理", "歴史", "言語", "文学"] },
] as const;

type SubjectGroupId = (typeof SUBJECT_GROUPS)[number]["id"];

const CONCEPT_GROUP_OVERRIDES: Record<string, SubjectGroupId> = {
  AIと情報社会: "aiData",
  AIシステム: "aiData",
  専門英語: "english",
  アルゴリズム: "algorithms",
  グラフアルゴリズム: "algorithms",
  "入試アルゴリズム・離散構造": "algorithms",
  情報理論: "signals",
  符号理論: "signals",
  "暗号・符号": "signals",
  フーリエ解析: "signals",
  ラプラス変換: "signals",
  離散信号変換: "signals",
  多重解像度表現: "signals",
  信号処理: "signals",
  システム解析: "signals",
  制御工学: "signals",
  制御システム: "signals",
  ネットワーク通信: "signals",
  計算機システム: "systems",
  情報システム: "systems",
};

function labelOf(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return "";
  return labels[value] ?? value;
}

function pdfPageUrl(url: string | null | undefined, page?: number | null) {
  if (!url) return "";
  const [base] = url.split("#");
  return page ? `${base}#page=${page}` : base;
}

function problemPdfUrl(problem: Pick<Problem, "id" | "source_url" | "page_start">) {
  return pdfPageUrl(problem.source_url, problem.page_start);
}

function pageLabel(problem: Pick<Problem, "page_start" | "page_end">) {
  if (!problem.page_start) return "ページ未設定";
  if (problem.page_end && problem.page_end !== problem.page_start) return `${problem.page_start}-${problem.page_end}ページ`;
  return `${problem.page_start}ページ`;
}

function problemSummary(problem: Pick<Problem, "graduate_school" | "subject_raw" | "page_start" | "page_end">) {
  return [problem.graduate_school, problem.subject_raw, pageLabel(problem)].filter(Boolean).join(" / ");
}

function conceptMatchesGroup(concept: Concept, groupId: SubjectGroupId) {
  if ((concept.problem_count ?? 0) <= 0) return false;
  const override = CONCEPT_GROUP_OVERRIDES[concept.name_ja];
  if (override) return override === groupId;
  const group = SUBJECT_GROUPS.find((item) => item.id === groupId);
  if (!group) return true;
  const text = `${concept.name_ja} ${concept.slug} ${concept.concept_type}`.toLowerCase();
  if (groupId === "english") {
    return ["英語", "英文", "読解", "語彙", "翻訳", "専門英語", "科学英語", "学術英語", "学術読解"].some((keyword) =>
      concept.name_ja.includes(keyword),
    );
  }
  return group.keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function App() {
  const [view, setView] = useState<View>(initialView);
  const [user, setUser] = useState<User | null>(null);
  const [query, setQuery] = useState("");
  const [conceptQuery, setConceptQuery] = useState("");
  const [subjectGroup, setSubjectGroup] = useState<SubjectGroupId>("math");
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedProblem, setSelectedProblem] = useState<ProblemDetail | null>(null);
  const [problemModalOpen, setProblemModalOpen] = useState(false);
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [studyGoal, setStudyGoal] = useState<StudyGoal | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPlanResponse | null>(null);
  const [learningGraphSubjects, setLearningGraphSubjects] = useState<LearningGraphSubject[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [dashboardRecommendationMode, setDashboardRecommendationMode] = useState<RecommendationMode>("normal");
  const [progress, setProgress] = useState<Array<Concept & { evidence_count: number; review_due_at: string | null }>>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      setBusy(true);
      const session = await api.session();
      const [conceptData, problemData, goalData, planData, progressData, graphSubjectData, recommendationData] = await Promise.all([
        api.concepts(),
        api.problems(new URLSearchParams()),
        api.studyGoal(),
        api.currentStudyPlan(),
        api.progress(),
        api.learningGraphSubjects(),
        api.recommendations("normal").catch(() => ({ recommendations: [] as Recommendation[] })),
      ]);
      setUser(session.user);
      setConcepts(conceptData.concepts);
      setProblems(problemData.problems);
      setStudyGoal(goalData.goal);
      setStudyPlan(planData.study_plan);
      setProgress(progressData.progress);
      setLearningGraphSubjects(graphSubjectData.subjects);
      setRecommendations(recommendationData.recommendations);
      if (view === "admin" && session.user.role === "member") setView("home");
      if (view === "model-health" && !canMonitorModels(session.user)) setView("home");
    } catch (error) {
      const message = error instanceof Error ? error.message : "初期化に失敗しました";
      if (message.includes("Authentication required")) {
        setAuthRequired(true);
        setNotice(null);
      } else {
        setNotice(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function searchProblems(nextQuery = query, nextConcept = selectedConcept?.slug ?? "") {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextConcept) params.set("concept", nextConcept);
    const { problems: nextProblems } = await api.problems(params);
    setProblems(nextProblems);
    setSearchResultsOpen(true);
  }

  async function browseStudyPlanConcept(conceptId: string) {
    const data = await api.concept(conceptId);
    setSelectedConcept(data.concept);
    setProblems(data.concept.problems);
    setView("concepts");
  }

  async function selectProblem(id: string) {
    const { problem } = await api.problem(id);
    setSelectedProblem(problem);
  }

  async function openProblem(id: string) {
    await selectProblem(id);
    setProblemModalOpen(true);
  }

  async function loadConcepts(q = conceptQuery) {
    const { concepts: next } = await api.concepts(q);
    setConcepts(next);
  }

  async function login(email: string, password: string) {
    await api.login(email, password);
    setAuthRequired(false);
    setNotice(null);
    await bootstrap();
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setAuthRequired(true);
    setView("home");
  }

  async function updateDepartment(department: string) {
    const profile = await api.updateProfile({ department });
    setUser(profile.user);
    const recommendationData = await api.recommendations("normal");
    setRecommendations(recommendationData.recommendations);
  }

  const weakConcepts = useMemo(
    () => [...progress].sort((a, b) => (a.mastery_score ?? 1) - (b.mastery_score ?? 1)).slice(0, 5),
    [progress],
  );
  const availableConceptCount = useMemo(
    () => concepts.filter((concept) => (concept.problem_count ?? 0) > 0).length,
    [concepts],
  );
  const visibleConcepts = useMemo(
    () => concepts.filter((concept) => conceptMatchesGroup(concept, subjectGroup)).slice(0, 120),
    [concepts, subjectGroup],
  );

  return (
    <div className={authRequired ? "app-shell auth-shell" : "app-shell"}>
      {!authRequired ? <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <BrandIcon />
          </div>
          <div>
            <strong>院試演習帳</strong>
            <span>分野から過去問を探す</span>
          </div>
        </div>
        <nav>
          <NavButton active={view === "home"} icon={<Home />} label="ホーム" onClick={() => setView("home")} />
          <NavButton active={view === "concepts"} icon={<GitBranch />} label="分野から探す" onClick={() => setView("concepts")} />
          <NavButton active={view === "study-plan"} icon={<Target />} label="学習計画" onClick={() => setView("study-plan")} />
          <NavButton active={view === "analytics"} icon={<ChartNoAxesCombined />} label="学習分析" onClick={() => setView("analytics")} />
          {canMonitorModels(user) ? <NavButton active={view === "model-health"} icon={<ShieldCheck />} label="モデル監視" onClick={() => setView("model-health")} /> : null}
          {canManageSources(user) ? <NavButton active={view === "admin"} icon={<Settings />} label="資料管理" onClick={() => setView("admin")} /> : null}
        </nav>
      </aside> : null}

      <main className="workspace">
        {!authRequired ? <header className="topbar">
          <div className="searchbar">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchProblems();
              }}
              placeholder="固有値、二分木、Union-Find"
            />
            <button onClick={() => void searchProblems()}>検索</button>
          </div>
          {user ? (
            <div className="topbar-user">
              <span>{user.display_name}</span>
              <button onClick={() => void logout()} title="ログアウト"><LogOut size={16} /> ログアウト</button>
            </div>
          ) : null}
        </header> : null}

        {notice && <div className="notice">{notice}</div>}
        {busy ? <div className="loading">読み込み中...</div> : null}

        {authRequired && !busy ? <AuthRequired onLogin={login} /> : null}

        {!authRequired && searchResultsOpen ? (
          <SearchResultsPanel
            problems={problems}
            query={query}
            onSelect={openProblem}
            onClose={() => setSearchResultsOpen(false)}
          />
        ) : null}

        {!authRequired && view === "home" && (
          <Dashboard
            user={user}
            studyPlan={studyPlan}
            weakConcepts={weakConcepts}
            progress={progress}
            initialRecommendations={recommendations}
            initialRecommendationMode={dashboardRecommendationMode}
            onDepartment={updateDepartment}
            onProblem={openProblem}
            onView={setView}
          />
        )}

        {!authRequired && view === "concepts" && (
          <ConceptExplorer
            concepts={visibleConcepts}
            query={conceptQuery}
            selected={selectedConcept}
            subjectGroup={subjectGroup}
            totalConcepts={availableConceptCount}
            visibleConceptCount={visibleConcepts.length}
            onQuery={setConceptQuery}
            onSearch={loadConcepts}
            onSubjectGroup={(group) => {
              setSubjectGroup(group);
              setSelectedConcept(null);
              setProblems([]);
            }}
            onSelect={async (concept) => {
              setSelectedConcept(concept);
              const data = await api.concept(concept.slug);
              setProblems(data.concept.problems);
            }}
            onProblem={openProblem}
            problems={problems}
          />
        )}

        {!authRequired && view === "study-plan" && (
          <StudyPlanView
            goal={studyGoal}
            studyPlan={studyPlan}
            availableSubjects={learningGraphSubjects}
            onGoal={setStudyGoal}
            onPlan={setStudyPlan}
            onSelect={openProblem}
            onBrowseConcept={browseStudyPlanConcept}
          />
        )}

        {!authRequired && view === "analytics" && <PersonalAnalyticsPage
          onPractice={(mode) => {
            setDashboardRecommendationMode(mode);
            setView("home");
          }}
          onStudyPlan={() => setView("study-plan")}
          onScheduleAdapted={(goal, plan) => {
            setStudyGoal(goal);
            setStudyPlan(plan);
            setView("study-plan");
          }}
          onPlanFocused={(plan) => {
            setStudyPlan(plan);
            setView("study-plan");
          }}
        />}

        {!authRequired && view === "model-health" && user && canMonitorModels(user) && <ModelHealthPage user={user} />}

        {!authRequired && view === "admin" && user && canManageSources(user) && <AdminPanel user={user} onCreated={bootstrap} />}
        {problemModalOpen && selectedProblem ? (
          <ProblemModal
            problem={selectedProblem}
            user={user}
            onClose={() => setProblemModalOpen(false)}
            onProblemUpdated={setSelectedProblem}
          />
        ) : null}
      </main>
    </div>
  );
}

function StandalonePdfPage() {
  const params = new URLSearchParams(window.location.search);
  const problemId = params.get("id") ?? "";
  const pageNumber = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadProblem() {
      if (!problemId) {
        setError("PDFを開くための問題IDがありません。");
        setBusy(false);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { problem: nextProblem } = await api.problem(problemId);
        if (!cancelled) setProblem(nextProblem);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "PDF情報を読み込めませんでした。");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void loadProblem();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const pdfUrl = problem ? problemPdfUrl(problem) : "";
  const originalPdfUrl = problem?.source_url ? pdfPageUrl(problem.source_url, pageNumber) : "";

  return (
    <main className="standalone-pdf-page">
      <header className="standalone-pdf-header">
        <div>
          <span>公式PDF</span>
          <h1>{problem ? `${problem.university} ${problem.exam_year} ${problem.problem_label}` : "PDFを開いています"}</h1>
          <p>{problem ? `${[problem.graduate_school, problem.subject_raw].filter(Boolean).join(" / ")} / ${pageNumber}ページ` : `${pageNumber}ページ`}</p>
        </div>
        <div className="standalone-pdf-actions">
          <a href="/">演習帳へ戻る</a>
          {originalPdfUrl ? <a href={originalPdfUrl} target="_blank" rel="noreferrer">元PDFを開く</a> : null}
        </div>
      </header>
      {busy ? <div className="loading">PDF情報を読み込んでいます...</div> : null}
      {error ? <div className="notice">{error}</div> : null}
      {pdfUrl && problem && !busy && !error ? <ExternalPdfViewer problem={problem} pageNumber={pageNumber} /> : null}
    </main>
  );
}

function RootApp() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("solve")) return <SolveWorkspacePage />;
  if (params.has("pdf")) return <StandalonePdfPage />;
  return <App />;
}

function AuthRequired({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "ログインできませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-required">
      <form className="login-card" onSubmit={submit}>
        <div className="login-icon"><LockKeyhole /></div>
        <div>
          <span className="dashboard-eyebrow">WELCOME BACK</span>
          <h1>院試演習帳にログイン</h1>
          <p>登録済みのメールアドレスとパスワードを入力してください。</p>
        </div>
        <label>
          メールアドレス
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          パスワード
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error ? <div className="login-error">{error}</div> : null}
        <button type="submit" disabled={submitting}>{submitting ? "確認中..." : "ログイン"}</button>
      </form>
    </section>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "nav active" : "nav"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function BrandIcon() {
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <rect className="brand-icon-bg" x="1" y="1" width="42" height="42" rx="10" />
      <path className="brand-icon-page" d="M11 12.5c4.5 0 7.2.8 10 3v17c-2.8-2.1-5.5-3-10-3z" />
      <path className="brand-icon-page" d="M33 12.5c-4.5 0-7.2.8-10 3v17c2.8-2.1 5.5-3 10-3z" />
      <path className="brand-icon-line" d="M15 18h4M15 23h4M27 18h3M27 23h3" />
      <path className="brand-icon-link" d="M14.5 32.5 22 27l7.5 5.5" />
      <circle className="brand-icon-node" cx="14.5" cy="32.5" r="2.1" />
      <circle className="brand-icon-node" cx="22" cy="27" r="2.1" />
      <circle className="brand-icon-node" cx="29.5" cy="32.5" r="2.1" />
      <path className="brand-icon-check" d="m18.2 11.4 2.4 2.4 5.2-5.8" />
    </svg>
  );
}

function Dashboard({
  user,
  studyPlan,
  weakConcepts,
  progress,
  initialRecommendations,
  initialRecommendationMode,
  onDepartment,
  onProblem,
  onView,
}: {
  user: User | null;
  studyPlan: StudyPlanResponse | null;
  weakConcepts: Concept[];
  progress: Array<Concept & { evidence_count: number; review_due_at: string | null }>;
  initialRecommendations: Recommendation[];
  initialRecommendationMode: RecommendationMode;
  onDepartment: (department: string) => Promise<void>;
  onProblem: (id: string) => Promise<void>;
  onView: (view: View) => void;
}) {
  const [recommendationMode, setRecommendationMode] = useState<RecommendationMode>(initialRecommendationMode);
  const [recommendationItems, setRecommendationItems] = useState(initialRecommendationMode === "normal" ? initialRecommendations : []);
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [departmentEditing, setDepartmentEditing] = useState(!user?.department);
  const [departmentDraft, setDepartmentDraft] = useState(user?.department ?? "");
  const [departmentBusy, setDepartmentBusy] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const recommendationModes = [
    { id: "normal", label: "バランス" },
    { id: "review", label: "復習" },
    { id: "foundation", label: "基礎" },
    { id: "challenge", label: "発展" },
  ] as const;

  useEffect(() => setRecommendationItems(initialRecommendations), [initialRecommendations]);
  useEffect(() => {
    if (initialRecommendationMode !== "normal") void changeRecommendationMode(initialRecommendationMode);
  }, []);

  async function changeRecommendationMode(mode: typeof recommendationMode) {
    setRecommendationMode(mode);
    setRecommendationBusy(true);
    setRecommendationError(null);
    try {
      const response = await api.recommendations(mode);
      setRecommendationItems(response.recommendations);
    } catch (error) {
      setRecommendationError(error instanceof Error ? error.message : "おすすめ問題を読み込めませんでした。");
    } finally {
      setRecommendationBusy(false);
    }
  }

  async function saveDepartment(event: React.FormEvent) {
    event.preventDefault();
    if (!departmentDraft.trim()) {
      setDepartmentError("学習したい分野を入力してください。");
      return;
    }
    setDepartmentBusy(true);
    setDepartmentError(null);
    try {
      await onDepartment(departmentDraft.trim());
      setRecommendationMode("normal");
      setDepartmentEditing(false);
    } catch (error) {
      setDepartmentError(error instanceof Error ? error.message : "学習分野を保存できませんでした。");
    } finally {
      setDepartmentBusy(false);
    }
  }

  return (
    <section className="dashboard-grid">
      <div className="dashboard-welcome span-2">
        <div>
          <span className="dashboard-eyebrow">PERSONAL STUDY PLAN</span>
          <h1>{user?.display_name ?? "学習者"}さん、今日の演習を始めましょう</h1>
          <p>
            {user?.department
              ? `${user.department}に近い出題分野と、これまでの学習記録から優先問題を選んでいます。`
              : "学習したい分野を登録すると、近い問題を優先して提案できます。"}
          </p>
        </div>
        {departmentEditing ? (
          <form className="department-editor" onSubmit={saveDepartment}>
            <label htmlFor="learning-field"><span>学習したい分野</span><input id="learning-field" value={departmentDraft} onChange={(event) => setDepartmentDraft(event.target.value)} maxLength={100} placeholder="例：情報工学、数学、電気電子" autoFocus /></label>
            <small>おすすめ問題の優先順位に使います。</small>
            {departmentError ? <p role="alert">{departmentError}</p> : null}
            <div><button type="submit" disabled={departmentBusy}>{departmentBusy ? "保存中" : "保存"}</button>{user?.department ? <button type="button" className="secondary-action" onClick={() => { setDepartmentDraft(user.department ?? ""); setDepartmentEditing(false); setDepartmentError(null); }}>キャンセル</button> : null}</div>
          </form>
        ) : (
          <button className="department-card" onClick={() => setDepartmentEditing(true)} title="学習分野を変更">
            <GraduationCap />
            <span>学習分野</span>
            <strong>{user?.department}</strong>
            <small>変更</small>
          </button>
        )}
      </div>
      <div className="panel span-2">
        <PanelTitle icon={<Target />} title="今日の学習計画" action="計画を見る" onAction={() => onView("study-plan")} />
        <div className="recommendation-list">
          {!studyPlan ? <span className="muted dashboard-empty">学習目標を設定すると、ナレッジグラフから今日の計画を作成します。</span> : null}
          {studyPlan && studyPlan.today.length === 0 ? <span className="muted dashboard-empty">今日の項目は完了しました。計画画面で次の予定を確認できます。</span> : null}
          {studyPlan?.today.slice(0, 4).map((item) => item.problem ? (
            <button key={item.id} className="recommendation-row" onClick={() => void onProblem(item.problem!.id)}>
              <div>
                <strong>{item.node_label}: {item.problem.university} {item.problem.problem_label}</strong>
                <span>{problemSummary(item.problem)}</span>
                <span className="recommendation-reasons"><em>{item.reason}</em></span>
              </div>
              {item.problem.completed ? <CompletedMark /> : null}
            </button>
          ) : <div key={item.id} className="recommendation-row concept-task"><div><strong>{item.node_label}</strong><span>{item.reason}</span></div></div>)}
        </div>
      </div>
      <div className="panel span-2 recommendation-panel">
        <div className="panel-title recommendation-panel-title">
          <div><BookOpen /><h2>おすすめ演習</h2></div>
          <div className="recommendation-modes" role="group" aria-label="おすすめの目的">
            {recommendationModes.map((mode) => (
              <button key={mode.id} className={recommendationMode === mode.id ? "active" : ""} onClick={() => void changeRecommendationMode(mode.id)} disabled={recommendationBusy}>{mode.label}</button>
            ))}
          </div>
        </div>
        <p className="recommendation-help">学習計画の対象外でも、公開済みの過去問から目的に合う問題を選べます。</p>
        {recommendationError ? <p className="form-status error recommendation-error" role="alert">{recommendationError}</p> : null}
        <div className="recommendation-list" aria-busy={recommendationBusy}>
          {recommendationBusy ? <span className="muted dashboard-empty">おすすめ問題を選び直しています...</span> : null}
          {!recommendationBusy && recommendationItems.length === 0 ? <span className="muted dashboard-empty">この条件に合う問題はまだありません。</span> : null}
          {!recommendationBusy ? recommendationItems.slice(0, 6).map((problem) => (
            <button key={problem.id} className="recommendation-row" onClick={() => void onProblem(problem.id)}>
              <div>
                <strong>{problem.university} {problem.exam_year} {problem.problem_label}</strong>
                <span>{problemSummary(problem)}</span>
                <span className="recommendation-reasons">{problem.reasons.slice(0, 3).map((reason) => <em key={reason}>{reason}</em>)}</span>
              </div>
              <span className="recommendation-difficulty">難易度 {problem.difficulty}<small>{problem.estimated_minutes}分</small></span>
              {problem.completed ? <CompletedMark /> : <span className="recommendation-start">問題を見る</span>}
            </button>
          )) : null}
        </div>
      </div>
      <div className="panel">
        <PanelTitle icon={<BarChart3 />} title="次に伸ばしたい分野" />
        <div className="concept-stack">
          {weakConcepts.length === 0 ? <span className="muted">学習記録を保存すると表示されます。</span> : null}
          {weakConcepts.map((concept) => (
            <ConceptPill key={concept.id} concept={concept} score={concept.mastery_score} />
          ))}
        </div>
      </div>
      <div className="panel">
        <PanelTitle icon={<ClipboardList />} title="復習タイミング" />
        <div className="due-list">
          {progress.slice(0, 5).map((item) => (
            <div key={item.id}>
              <strong>{item.name_ja}</strong>
              <span>{item.review_due_at ? new Date(item.review_due_at).toLocaleDateString("ja-JP") : "未設定"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PanelTitle({ icon, title, action, onAction }: { icon: React.ReactNode; title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-title">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  );
}

function SearchResultsPanel({
  problems,
  query,
  onSelect,
  onClose,
}: {
  problems: Problem[];
  query: string;
  onSelect: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <section className="panel search-results-panel">
      <PanelTitle icon={<Search />} title={query ? `「${query}」の検索結果` : "検索結果"} action="閉じる" onAction={onClose} />
      <ProblemListBody problems={problems} onSelect={onSelect} />
    </section>
  );
}

function ProblemList({ problems, selectedId, onSelect }: { problems: Problem[]; selectedId?: string; onSelect: (id: string) => Promise<void> }) {
  return (
    <div className="panel list-panel">
      <PanelTitle icon={<BookOpen />} title="問題一覧" />
      <ProblemListBody problems={problems} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

function ProblemListBody({ problems, selectedId, onSelect }: { problems: Problem[]; selectedId?: string; onSelect: (id: string) => Promise<void> }) {
  return (
    <div className="problem-list">
      {problems.length === 0 ? <span className="muted">条件に合う問題がありません。</span> : null}
      {problems.map((problem) => (
        <button key={problem.id} className={problem.id === selectedId ? "problem-row selected" : "problem-row"} onClick={() => void onSelect(problem.id)}>
            <div className="row-meta">
              <span>{problem.university}</span>
              <span>{problem.exam_year}</span>
              <span>{problem.problem_label}</span>
              <span>{pageLabel(problem)}</span>
              <span className="reviewed">{labelOf(STATUS_LABELS, problem.status)}</span>
            </div>
            <strong>{problem.subject_raw ?? problem.problem_label}</strong>
            <span className="problem-summary">{problemSummary(problem)}</span>
            <div className="concept-line">
              {problem.concepts.slice(0, 4).map((concept) => (
                <span key={concept.id}>{concept.name_ja}</span>
              ))}
            </div>
        </button>
      ))}
    </div>
  );
}

function ProblemModal({
  problem,
  user,
  onClose,
  onProblemUpdated,
}: {
  problem: ProblemDetail;
  user: User | null;
  onClose: () => void;
  onProblemUpdated: (problem: ProblemDetail) => void;
}) {
  const solveUrl = `/?${new URLSearchParams({ solve: "1", id: problem.id }).toString()}`;
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="problem-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="problem-modal-title" tabIndex={-1}>
        <div className="modal-bar">
          <div>
            <span>問題プレビュー</span>
            <strong id="problem-modal-title">{problem.university} {problem.exam_year} {problem.problem_label}</strong>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="閉じる" title="閉じる"><X /></button>
        </div>
        <ProblemPreviewPanel problem={problem} user={user} onProblemUpdated={onProblemUpdated} />
        <div className="modal-start-bar">
          <a className="solve-cta" href={solveUrl} target="_blank" rel="noreferrer"><Play />この問題を解く</a>
        </div>
      </div>
    </div>
  );
}

function canEditProblem(user: User | null) {
  return user?.role === "editor" || user?.role === "reviewer" || user?.role === "admin";
}

function ProblemPreviewPanel({
  problem,
  user,
  onProblemUpdated,
}: {
  problem: ProblemDetail | null;
  user: User | null;
  onProblemUpdated?: (problem: ProblemDetail) => void;
}) {
  const [editingMemo, setEditingMemo] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoMessage, setMemoMessage] = useState<string | null>(null);
  const [memoError, setMemoError] = useState<string | null>(null);

  useEffect(() => {
    setMemoDraft(problem?.explanation_text ?? "");
    setEditingMemo(false);
    setMemoMessage(null);
    setMemoError(null);
  }, [problem?.id]);

  useEffect(() => {
    if (!editingMemo) setMemoDraft(problem?.explanation_text ?? "");
  }, [editingMemo, problem?.explanation_text]);

  if (!problem) return <div className="panel detail-panel empty">問題を選択してください。</div>;
  const editable = canEditProblem(user) && !problem.governed_original;
  const explanationText = memoDraft.trim();

  async function saveExplanationMemo() {
    if (!problem) return;
    setMemoSaving(true);
    setMemoMessage(null);
    setMemoError(null);
    try {
      await api.updateProblem(problem.id, { explanation_text: memoDraft.trim() || null });
      const { problem: updatedProblem } = await api.problem(problem.id);
      onProblemUpdated?.(updatedProblem);
      setMemoDraft(updatedProblem.explanation_text ?? "");
      setEditingMemo(false);
      setMemoMessage("解き方メモを保存しました。");
    } catch (error) {
      setMemoError(error instanceof Error ? error.message : "解き方メモを保存できませんでした。");
    } finally {
      setMemoSaving(false);
    }
  }

  return (
    <div className="panel detail-panel">
      <div className="detail-head">
        <div>
          <span className="source">{problem.university} / {problem.exam_year} / {problem.problem_label}</span>
          <h1>{problem.subject_raw ?? "問題"}</h1>
        </div>
        <div className="difficulty">難易度 {problem.difficulty} / {problem.estimated_minutes}分</div>
      </div>
      {problem.source_url ? <section className="pdf-block">
        <div className="pdf-toolbar"><div><strong>問題PDF</strong><span>{pageLabel(problem)}を開いています</span></div></div>
        <ExternalPdfViewer problem={problem} pageNumber={problem.page_start ?? 1} compact />
      </section> : (
        <section className="original-problem-block" aria-label="オリジナル診断問題">
          <span>ORIGINAL DIAGNOSTIC ITEM</span>
          <h2>{problem.problem_label}</h2>
          <p>{problem.statement_text}</p>
        </section>
      )}
      {problem.source_url && problem.statement_text ? (
        <details className="statement-details">
          <summary>登録メモを表示</summary>
          <p className="statement">{problem.statement_text}</p>
        </details>
      ) : null}
      <div className="concept-line large">
        {problem.concepts.map((concept) => (
          <ConceptPill key={concept.id} concept={concept} score={concept.mastery_score} />
        ))}
      </div>
      <section className="answer-block guided-block">
        <div className="section-head">
          <div>
            <h3>解き方メモ</h3>
            <p className="section-help">この問題の解説・方針です。自分用の復習メモは、解答画面を終了するときに記録できます。</p>
          </div>
          {editable ? (
            <button className="secondary-action" onClick={() => setEditingMemo((current) => !current)}>
              {editingMemo ? "表示に戻る" : "解き方メモを編集"}
            </button>
          ) : null}
        </div>
        {editingMemo ? (
          <div className="memo-editor">
            <label htmlFor={`explanation-${problem.id}`}>管理者・編集者用の解説メモ</label>
            <textarea
              id={`explanation-${problem.id}`}
              value={memoDraft}
              onChange={(event) => setMemoDraft(event.target.value)}
              placeholder="解法の入口、使う定理、典型的な落とし穴などを登録"
            />
            <div className="memo-actions">
              <button onClick={() => void saveExplanationMemo()} disabled={memoSaving}>
                {memoSaving ? "保存中" : "解き方メモを保存"}
              </button>
              <button
                className="secondary-action"
                onClick={() => {
                  setMemoDraft(problem.explanation_text ?? "");
                  setEditingMemo(false);
                  setMemoError(null);
                }}
                disabled={memoSaving}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <p className={explanationText ? "memo-text" : "memo-empty"}>
            {explanationText || (editable ? "未登録です。「解き方メモを編集」から登録できます。" : "解き方メモはまだ登録されていません。")}
          </p>
        )}
        {memoMessage ? <p className="form-status success">{memoMessage}</p> : null}
        {memoError ? <p className="form-status error">{memoError}</p> : null}
      </section>
      <section className="similar-block">
        <h3>似た問題</h3>
        {problem.similar.length === 0 ? <span className="muted">似た問題はまだありません。</span> : null}
        {problem.similar.map((item) => (
          <div key={item.id} className="similar-row">
            <span>{item.university} {item.exam_year} {item.problem_label}</span>
            <meter min={0} max={1} value={item.score} />
          </div>
        ))}
      </section>
      <section className="attempt-history guided-block">
        <div className="section-head">
          <div>
            <h3>これまでの学習記録</h3>
            <p className="section-help">この画面は下見用です。開いただけでは学習開始にも、解いた判定にもなりません。</p>
          </div>
        </div>
        {problem.attempts.length === 0 ? <p className="memo-empty">まだ学習記録はありません。</p> : null}
        <div className="attempt-history-list">
          {problem.attempts.map((attempt) => (
            <article key={attempt.id}>
              <div>
                <strong>{attempt.result === "correct" ? "解けた" : attempt.result === "partial" ? "途中まで" : attempt.result === "wrong" ? "解けなかった" : "見送った"}</strong>
                <span>{new Date(attempt.created_at).toLocaleDateString("ja-JP")}</span>
              </div>
              <span>{attempt.time_spent_minutes == null ? "時間未記録" : `${attempt.time_spent_minutes}分`}</span>
              <div className="attempt-signals">
                {attempt.self_confidence ? <span>自信度 {attempt.self_confidence}/5</span> : null}
                {attempt.used_hint ? <span>ヒント使用</span> : null}
                {attempt.looked_solution ? <span>解答参照</span> : null}
              </div>
              {attempt.note ? <p>{attempt.note}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ExternalPdfViewer({ problem, pageNumber, compact = false }: { problem: Problem; pageNumber: number; compact?: boolean }) {
  const sourceUrl = pdfPageUrl(problem.source_url, pageNumber);
  if (!sourceUrl) return <div className="pdf-missing">公開元PDFが登録されていません。</div>;
  if (problem.pdf_display_mode !== "embed") {
    return (
      <div className="pdf-viewer-shell">
        <div className="pdf-fallback-panel">
          <strong>このPDFはサイト内表示に対応していません。</strong>
          <span>{pageLabel(problem)}を確認してください。</span>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />公式PDFを別タブで開く</a>
        </div>
      </div>
    );
  }
  return (
    <div className={`pdf-viewer-shell external ${compact ? "compact" : ""}`}>
      <iframe className="pdf-viewer" src={sourceUrl} title={`${problem.problem_label} 公式PDF`} />
      <div className="pdf-embed-help">表示されない場合は <a href={sourceUrl} target="_blank" rel="noopener noreferrer">公式PDFを別タブで開く</a></div>
    </div>
  );
}

function ConceptPill({ concept, score }: { concept: Concept; score?: number | null }) {
  return (
    <span className="concept-pill">
      {concept.name_ja}
      {typeof score === "number" ? <meter min={0} max={1} value={score} /> : null}
    </span>
  );
}

function ConceptExplorer({
  concepts,
  query,
  selected,
  subjectGroup,
  totalConcepts,
  visibleConceptCount,
  problems,
  onQuery,
  onSearch,
  onSubjectGroup,
  onSelect,
  onProblem,
}: {
  concepts: Concept[];
  query: string;
  selected: Concept | null;
  subjectGroup: SubjectGroupId;
  totalConcepts: number;
  visibleConceptCount: number;
  problems: Problem[];
  onQuery: (value: string) => void;
  onSearch: () => Promise<void>;
  onSubjectGroup: (group: SubjectGroupId) => void;
  onSelect: (concept: Concept) => Promise<void>;
  onProblem: (id: string) => Promise<void>;
}) {
  return (
    <section className="split">
      <div className="panel list-panel">
        <PanelTitle icon={<GitBranch />} title="分野から探す" />
        <div className="subject-tabs">
          {SUBJECT_GROUPS.map((group) => (
            <button key={group.id} className={subjectGroup === group.id ? "active" : ""} onClick={() => onSubjectGroup(group.id)}>
              {group.label}
            </button>
          ))}
        </div>
        <div className="concept-count">{totalConcepts}件から{visibleConceptCount}件を表示</div>
        <div className="inline-search">
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="分野名・キーワード" />
          <button onClick={() => void onSearch()}>検索</button>
        </div>
        <div className="concept-list">
          {concepts.map((concept) => (
            <button key={concept.id} className={selected?.id === concept.id ? "concept-row selected" : "concept-row"} onClick={() => void onSelect(concept)}>
              <strong>{concept.name_ja}</strong>
              <span>代表問題 {concept.problem_count ?? 0}問</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel detail-panel">
        <PanelTitle icon={<Database />} title={selected ? `${selected.name_ja} の代表問題` : "分野を選択"} />
        <div className="problem-list compact">
          {!selected ? <span className="muted">左の分野を選ぶと代表問題が表示されます。</span> : null}
          {selected && problems.length === 0 ? <span className="muted">この分野の代表問題はまだ登録されていません。</span> : null}
          {selected ? problems.map((problem) => (
            <button key={problem.id} className="problem-row" onClick={() => void onProblem(problem.id)}>
              <div className="row-meta">
                <span>{problem.university}</span>
                <span>{problem.exam_year}</span>
                <span>難易度 {problem.difficulty}</span>
                <span>{pageLabel(problem)}</span>
              </div>
              <strong>{problem.subject_raw ?? problem.problem_label}</strong>
              <span className="problem-summary">{problemSummary(problem)}</span>
              {problem.completed ? <CompletedMark /> : null}
            </button>
          )) : null}
        </div>
      </div>
    </section>
  );
}

function StudyPlanView({ goal, studyPlan, availableSubjects, onGoal, onPlan, onSelect, onBrowseConcept }: {
  goal: StudyGoal | null;
  studyPlan: StudyPlanResponse | null;
  availableSubjects: LearningGraphSubject[];
  onGoal: (goal: StudyGoal) => void;
  onPlan: (plan: StudyPlanResponse | null) => void;
  onSelect: (id: string) => Promise<void>;
  onBrowseConcept: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(!goal);
  const [goalText, setGoalText] = useState(goal?.goal_text ?? "大学院入試に向けて基礎から応用まで学びたい");
  const [subjectKey, setSubjectKey] = useState(goal?.subject_key ?? "algorithms");
  const [targetUniversity, setTargetUniversity] = useState(goal?.target_university ?? "");
  const [targetGraduateSchool, setTargetGraduateSchool] = useState(goal?.target_graduate_school ?? "");
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [sessionsPerWeek, setSessionsPerWeek] = useState(String(goal?.sessions_per_week ?? 5));
  const [minutesPerSession, setMinutesPerSession] = useState(String(goal?.minutes_per_session ?? 45));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableSubjectKeys = useMemo(() => new Set(availableSubjects.map((subject) => subject.subject_key)), [availableSubjects]);
  const subjectReady = availableSubjectKeys.has(subjectKey);
  const selectedSubjectLabel = SUBJECT_GROUPS.find((subject) => subject.id === subjectKey)?.label ?? subjectKey;
  const availableSubjectLabels = SUBJECT_GROUPS
    .filter((subject) => availableSubjectKeys.has(subject.id))
    .map((subject) => subject.label);
  const pendingPlanItems = studyPlan?.items.filter((item) => item.status === "pending") ?? [];
  const completedPlanItemCount = studyPlan?.items.filter((item) => item.status === "completed").length ?? 0;
  const skippedPlanItemCount = studyPlan?.items.filter((item) => item.status === "skipped").length ?? 0;

  useEffect(() => {
    if (!goal) return;
    setGoalText(goal.goal_text);
    setSubjectKey(goal.subject_key);
    setTargetUniversity(goal.target_university ?? "");
    setTargetGraduateSchool(goal.target_graduate_school ?? "");
    setTargetDate(goal.target_date ?? "");
    setSessionsPerWeek(String(goal.sessions_per_week));
    setMinutesPerSession(String(goal.minutes_per_session));
    setEditing(false);
  }, [goal?.id]);

  async function saveAndGenerate(event: React.FormEvent) {
    event.preventDefault();
    if (!subjectReady) {
      setError(`「${selectedSubjectLabel}」の学習グラフは準備中です。利用可能な科目を選んでください。`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { goal: savedGoal } = await api.saveStudyGoal({
        goal_text: goalText,
        subject_key: subjectKey,
        target_university: targetUniversity || null,
        target_graduate_school: targetGraduateSchool || null,
        target_date: targetDate || null,
        sessions_per_week: Number(sessionsPerWeek),
        minutes_per_session: Number(minutesPerSession),
      });
      onGoal(savedGoal);
      const { study_plan: nextPlan } = await api.generateStudyPlan();
      onPlan(nextPlan);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "学習計画を作成できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function refreshPlan() {
    setBusy(true);
    setError(null);
    try {
      const { study_plan: nextPlan } = await api.generateStudyPlan();
      onPlan(nextPlan);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "学習計画を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function finishConceptItem(id: string) {
    await api.completeStudyPlanItem(id, "completed");
    const { study_plan: nextPlan } = await api.currentStudyPlan();
    onPlan(nextPlan);
  }

  return (
    <section className="study-plan-page">
      <div className="panel study-plan-head">
        <div>
          <span className="dashboard-eyebrow">KNOWLEDGE GRAPH STUDY PLAN</span>
          <h1>{studyPlan?.plan.topic ?? "学習計画"}</h1>
          <p>{goal?.goal_text ?? "目標を設定すると、前提関係と学習履歴から計画を作成します。"}</p>
        </div>
        <div className="study-plan-head-actions">
          {goal ? <button className="secondary-action" onClick={() => setEditing((current) => !current)}>目標を編集</button> : null}
          {studyPlan ? <button onClick={() => void refreshPlan()} disabled={busy}>{busy ? "更新中..." : "計画を再生成"}</button> : null}
        </div>
      </div>

      {editing ? (
        <form className="panel study-goal-form" onSubmit={saveAndGenerate}>
          <PanelTitle icon={<Target />} title="学習目標を設定" />
          <label className="span-2"><span>目標</span><textarea value={goalText} onChange={(event) => setGoalText(event.target.value)} maxLength={500} required /></label>
          <label><span>対象科目</span><select value={subjectKey} onChange={(event) => { setSubjectKey(event.target.value); setError(null); }}>{SUBJECT_GROUPS.map((subject) => {
            const ready = availableSubjectKeys.has(subject.id);
            return <option key={subject.id} value={subject.id} disabled={!ready}>{subject.label}{ready ? "" : "（準備中）"}</option>;
          })}</select><small className="field-help">現在利用可能: {availableSubjectLabels.join("、") || "なし"}</small></label>
          <label><span>志望大学 <em>任意</em></span><input value={targetUniversity} onChange={(event) => setTargetUniversity(event.target.value)} maxLength={100} placeholder="例：京都大学" /><small className="field-help">一致する大学の問題を優先します。</small></label>
          <label><span>志望研究科・専攻 <em>任意</em></span><input value={targetGraduateSchool} onChange={(event) => setTargetGraduateSchool(event.target.value)} maxLength={100} placeholder="例：情報学研究科" /><small className="field-help">一致する研究科・専攻をさらに優先します。</small></label>
          <label><span>試験日（任意）</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
          <label><span>週あたりの日数</span><input type="number" min="1" max="7" value={sessionsPerWeek} onChange={(event) => setSessionsPerWeek(event.target.value)} /></label>
          <label><span>1回の学習時間</span><input type="number" min="15" max="180" step="5" value={minutesPerSession} onChange={(event) => setMinutesPerSession(event.target.value)} /></label>
          {error ? <p className="form-status error span-2" role="alert">{error}</p> : null}
          {!subjectReady ? <p className="subject-unavailable span-2"><CircleAlert />この科目はKnowledgeGraphの生成・レビューがまだ完了していません。</p> : null}
          <div className="study-goal-actions span-2"><button type="submit" disabled={busy || !subjectReady}>{busy ? "計画を作成中..." : "目標を保存して計画を作る"}</button></div>
        </form>
      ) : null}

      {!editing && error ? <div className="notice" role="alert">{error}</div> : null}
      {!editing && !studyPlan ? (
        <div className="panel study-plan-empty">
          <CircleAlert />
          <div>
            <h2>{goal && !availableSubjectKeys.has(goal.subject_key) ? `「${SUBJECT_GROUPS.find((subject) => subject.id === goal.subject_key)?.label ?? goal.subject_key}」は準備中です` : "学習計画を作成しましょう"}</h2>
            <p>{goal && !availableSubjectKeys.has(goal.subject_key)
              ? `現在利用できるのは${availableSubjectLabels.join("、") || "準備済み科目なし"}です。学習グラフが有効化された科目だけ計画を作成できます。`
              : "目標と学習頻度を設定すると、前提関係と習得度から14日間の計画を作成します。"}</p>
          </div>
          <button onClick={() => setEditing(true)}>科目・目標を設定</button>
        </div>
      ) : null}
      {!editing && studyPlan ? (
        <>
          <div className="panel study-roadmap">
            <PanelTitle icon={<GitBranch />} title="学習ロードマップ" />
            <div className="roadmap-layers">
              {[0, 1, 2, 3].map((layer) => (
                <section key={layer}>
                  <h3>{["前提", "基礎", "中核", "応用"][layer]}</h3>
                  <div>{studyPlan.nodes.filter((node) => node.layer === layer).map((node) => (
                    <article key={node.id} className={`roadmap-node ${node.status}`}>
                      <div><strong>{node.label}</strong><span>{node.status === "completed" ? "習得済み" : node.status === "ready" ? "学習可能" : "前提待ち"}</span></div>
                      <p>{node.description}</p>
                      <meter min={0} max={1} value={node.mastery} />
                      <small>{node.mastery_basis === "prior" ? "記録なし・中立値で表示" : `証拠 ${node.evidence_count}件・保守推定`}</small>
                    </article>
                  ))}</div>
                </section>
              ))}
            </div>
          </div>

          <div className="panel study-schedule">
            <PanelTitle icon={<ClipboardList />} title="これからの14日間" />
            {completedPlanItemCount > 0 ? <p className="study-schedule-summary">この計画で完了済み: {completedPlanItemCount}件</p> : null}
            {skippedPlanItemCount > 0 ? <p className="study-schedule-summary">見送り: {skippedPlanItemCount}件</p> : null}
            <div className="study-session-list">
              {pendingPlanItems.map((item) => (
                <article key={item.id} className={`study-session ${item.status}`}>
                  <div className="study-session-date"><strong>{new Date(`${item.scheduled_date}T00:00:00`).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}</strong><span>{item.estimated_minutes}分</span></div>
                  <div><strong>{item.node_label}</strong><span>{item.reason}</span>{item.problem ? <small>{item.problem.university} {item.problem.exam_year} {item.problem.problem_label} / {pageLabel(item.problem)}</small> : <small>{item.concepts?.length ? `対応分野: ${item.concepts.map((concept) => concept.name_ja).join("、")}` : "対応する分野はまだ登録されていません。"}</small>}</div>
                  {item.problem ? <button onClick={() => void onSelect(item.problem!.id)}>問題を見る</button> : <div className="study-session-actions">{item.concepts?.find((concept) => (concept.problem_count ?? 0) > 0) ? <button className="secondary-action" onClick={() => void onBrowseConcept(item.concepts!.find((concept) => (concept.problem_count ?? 0) > 0)!.id)}>分野の問題を見る</button> : null}<button onClick={() => void finishConceptItem(item.id)}>完了</button></div>}
                </article>
              ))}
              {pendingPlanItems.length === 0 ? <p className="study-schedule-summary">未完了の予定はありません。計画を再生成して次の演習を追加できます。</p> : null}
            </div>
          </div>

          <p className="study-plan-provenance">グラフ出典: <a href={studyPlan.plan.source_repository} target="_blank" rel="noopener noreferrer">KTaisei/KnowledgeGraph</a> / commit {studyPlan.plan.source_commit.slice(0, 8)}</p>
        </>
      ) : null}
    </section>
  );
}

function CompletedMark() {
  return <span className="problem-completed" aria-label="解答済み" title="解答済み"><CheckCircle2 /></span>;
}

function AdminPanel({ user, onCreated }: { user: User; onCreated: () => Promise<void> }) {
  const pageSize = 50;
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUniversity, setSourceUniversity] = useState("");
  const [sourceYear, setSourceYear] = useState(String(new Date().getFullYear()));
  const [sourceUrl, setSourceUrl] = useState("");
  const [publisherPageUrl, setPublisherPageUrl] = useState("");
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [stats, setStats] = useState<SourceStats | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [universityFilter, setUniversityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [displayFilter, setDisplayFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const canReview = canReviewSources(user);

  useEffect(() => {
    void api.sourceStats().then(setStats).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "集計を読み込めませんでした。"));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSources(0), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, universityFilter, statusFilter, displayFilter]);

  function sourceParams(nextOffset: number) {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(nextOffset) });
    if (query.trim()) params.set("q", query.trim());
    if (universityFilter) params.set("university", universityFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (displayFilter) params.set("display", displayFilter);
    return params;
  }

  async function loadSources(nextOffset = offset) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const sourceData = await api.sources(sourceParams(nextOffset));
      if (sequence !== requestSequence.current) return;
      setSources(sourceData.sources);
      setTotal(sourceData.total);
      setOffset(sourceData.offset);
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "資料を読み込めませんでした。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  async function refreshAll() {
    try {
      const [, nextStats] = await Promise.all([loadSources(offset), api.sourceStats()]);
      setStats(nextStats);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "集計を更新できませんでした。");
    }
  }

  async function createPublicSource(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setStatus("");
    setError("");
    try {
      const result = await api.createSource({
        source_type: "official_pdf",
        title: sourceTitle,
        university: sourceUniversity,
        exam_year: Number(sourceYear),
        source_url: sourceUrl,
        publisher_page_url: publisherPageUrl || undefined,
        access_scope: "source_link_only",
        pdf_display_mode: "external_only",
        source_status: "needs_review",
      });
      setStatus(`資料を確認待ちとして登録しました（${result.id}）`);
      setSourceTitle("");
      setSourceUniversity("");
      setSourceUrl("");
      setPublisherPageUrl("");
      await refreshAll();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "資料を登録できませんでした。");
    } finally {
      setCreating(false);
    }
  }

  async function reviewSource(source: SourceDocument, change: Record<string, unknown>) {
    setUpdatingId(source.id);
    setStatus("");
    setError("");
    try {
      await api.updateSource(source.id, change);
      setStatus(`「${source.title}」の表示設定を更新しました。`);
      await refreshAll();
      await onCreated();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "表示設定を更新できませんでした。");
    } finally {
      setUpdatingId(null);
    }
  }

  function statusCount(value: SourceDocument["source_status"]) {
    return stats?.byStatus.find((item) => item.source_status === value)?.count ?? 0;
  }

  function sourceHostname(source: SourceDocument) {
    try {
      return source.source_url ? new URL(source.source_url).hostname : "URL未設定";
    } catch {
      return "URL要確認";
    }
  }

  function canActivate(source: SourceDocument) {
    return Boolean(source.source_url && source.access_scope !== "restricted" && sourceHostname(source) !== "raw.githubusercontent.com");
  }

  return (
    <section className="source-admin-page">
      <header className="source-admin-header">
        <div><span className="dashboard-eyebrow">SOURCE LIBRARY</span><h1>資料管理</h1><p>公式PDFの公開状態と表示方法を確認・管理します。</p></div>
        <button className="source-refresh" onClick={() => void refreshAll()} disabled={loading}><RefreshCw />{loading ? "更新中" : "最新の状態に更新"}</button>
      </header>

      <div className="source-kpis" aria-label="資料の状態別件数">
        <button className={!statusFilter ? "source-kpi active" : "source-kpi"} onClick={() => setStatusFilter("")}><Database /><span>すべて</span><strong>{stats?.total ?? 0}</strong><small>登録資料</small></button>
        <button className={statusFilter === "active" ? "source-kpi active" : "source-kpi"} onClick={() => setStatusFilter("active")}><FileCheck2 /><span>公開中</span><strong>{statusCount("active")}</strong><small>学習者に表示</small></button>
        <button className={statusFilter === "needs_review" ? "source-kpi active" : "source-kpi"} onClick={() => setStatusFilter("needs_review")}><CircleAlert /><span>確認待ち</span><strong>{statusCount("needs_review")}</strong><small>公開前の確認が必要</small></button>
        <button className={statusFilter === "unavailable" ? "source-kpi active" : "source-kpi"} onClick={() => setStatusFilter("unavailable")}><ShieldCheck /><span>利用停止</span><strong>{statusCount("unavailable")}</strong><small>現在は非公開</small></button>
      </div>

      {status ? <div className="form-status success" role="status">{status}</div> : null}
      {error ? <div className="form-status error" role="alert">{error}</div> : null}

      <DiagnosticContentAdmin user={user} onChanged={onCreated} />
      <DiagnosticBlueprintAdmin user={user} />
      <DiagnosticProblemContentAdmin user={user} />

      <details className="panel source-create-panel">
        <summary><span><FilePlus2 />新しい公式資料を登録</span><small>PDFファイルは保存せず、公開元URLだけを登録します</small><ChevronRight /></summary>
        <form className="source-link-form" onSubmit={createPublicSource}>
          <label className="span-2" htmlFor="source-title"><span>資料名</span><input id="source-title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="例：2026年度 情報学研究科 入試問題" required /></label>
          <label htmlFor="source-university"><span>大学名</span><input id="source-university" value={sourceUniversity} onChange={(event) => setSourceUniversity(event.target.value)} required /></label>
          <label htmlFor="source-year"><span>年度</span><input id="source-year" type="number" value={sourceYear} onChange={(event) => setSourceYear(event.target.value)} min="1900" max="2100" required /></label>
          <label className="span-2" htmlFor="source-pdf-url"><span>公式PDF URL</span><input id="source-pdf-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://.../exam.pdf" required /></label>
          <label className="span-2" htmlFor="source-page-url"><span>公式掲載ページ URL <em>任意</em></span><input id="source-page-url" type="url" value={publisherPageUrl} onChange={(event) => setPublisherPageUrl(event.target.value)} placeholder="https://.../past-exams" /></label>
          <div className="source-form-note span-2"><ShieldCheck />登録後は「確認待ち」になります。レビュー担当者がリンクと公開条件を確認してから有効化します。</div>
          <div className="source-form-actions span-2"><button type="submit" disabled={creating}>{creating ? "登録中..." : "確認待ちとして登録"}</button></div>
        </form>
      </details>

      <section className="panel source-library-panel">
        <div className="source-library-title"><div><span>登録済み資料</span><h2>{total.toLocaleString("ja-JP")}件</h2></div><p>公開状態とPDF表示方式を行ごとに確認できます。</p></div>
        <div className="source-filters">
          <label className="source-filter-search" htmlFor="source-search"><Search /><span className="sr-only">資料を検索</span><input id="source-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="資料名・大学・研究科で検索" /></label>
          <label><Filter /><span className="sr-only">大学で絞り込み</span><select value={universityFilter} onChange={(event) => setUniversityFilter(event.target.value)}><option value="">すべての大学</option>{stats?.byUniversity.map((item) => <option key={item.university} value={item.university}>{item.university}（{item.count}）</option>)}</select></label>
          <label><span className="sr-only">公開状態で絞り込み</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">すべての状態</option><option value="active">公開中</option><option value="needs_review">確認待ち</option><option value="unavailable">利用停止</option></select></label>
          <label><span className="sr-only">表示方式で絞り込み</span><select value={displayFilter} onChange={(event) => setDisplayFilter(event.target.value)}><option value="">すべての表示方式</option><option value="external_only">別タブ表示</option><option value="embed">サイト内表示</option></select></label>
        </div>

        <div className="source-table-shell" aria-busy={loading}>
          <table className="source-data-table">
            <thead><tr><th>資料</th><th>年度・問題</th><th>公開状態</th><th>PDF表示</th><th>リンク</th><th>操作</th></tr></thead>
            <tbody>
              {!loading && sources.length === 0 ? <tr><td colSpan={6}><div className="source-empty"><Search /><strong>条件に一致する資料がありません</strong><span>検索語や絞り込み条件を変更してください。</span></div></td></tr> : null}
              {sources.map((source) => (
                <tr key={source.id}>
                  <td data-label="資料"><strong className="source-title-cell">{source.title}</strong><span>{source.university}{source.graduate_school ? ` / ${source.graduate_school}` : ""}</span><small>{sourceHostname(source)}</small></td>
                  <td data-label="年度・問題"><strong>{source.exam_year}年度</strong><span>{Number(source.problem_count).toLocaleString("ja-JP")}問</span></td>
                  <td data-label="公開状態"><span className={`source-badge ${source.source_status}`}>{SOURCE_STATUS_LABELS[source.source_status]}</span><small>{labelOf(ACCESS_SCOPE_LABELS, source.access_scope)}</small></td>
                  <td data-label="PDF表示"><span className={`source-badge display ${source.pdf_display_mode}`}>{PDF_DISPLAY_LABELS[source.pdf_display_mode]}</span><small>{source.source_checked_at ? `確認 ${new Date(`${source.source_checked_at}Z`).toLocaleDateString("ja-JP")}` : "未確認"}</small></td>
                  <td data-label="リンク"><div className="source-links">{source.source_url ? <a href={source.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink />PDF</a> : null}{source.publisher_page_url ? <a href={source.publisher_page_url} target="_blank" rel="noopener noreferrer"><Link2 />掲載ページ</a> : null}</div></td>
                  <td data-label="操作"><div className="source-row-actions">
                    {canReview && source.source_status !== "active" && canActivate(source) ? <button onClick={() => void reviewSource(source, { source_status: "active", access_scope: "source_link_only", pdf_display_mode: "external_only" })} disabled={updatingId === source.id}>公開する</button> : null}
                    {canReview && source.source_status === "active" ? <button className="secondary-action" onClick={() => void reviewSource(source, { pdf_display_mode: source.pdf_display_mode === "embed" ? "external_only" : "embed" })} disabled={updatingId === source.id}>{source.pdf_display_mode === "embed" ? "別タブ表示へ" : "埋め込み許可"}</button> : null}
                    {canReview && source.source_status === "active" ? <button className="quiet-danger" onClick={() => { if (window.confirm(`「${source.title}」を学習者から非表示にしますか？`)) void reviewSource(source, { source_status: "unavailable" }); }} disabled={updatingId === source.id}>利用停止</button> : null}
                    {!canReview ? <span className="source-action-note">レビュー権限が必要</span> : null}
                    {canReview && source.source_status !== "active" && !canActivate(source) ? <span className="source-action-note">{source.access_scope === "restricted" ? "利用条件により非公開" : "外部ミラーのため非公開"}</span> : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="source-loading">資料を読み込んでいます...</div> : null}
        </div>

        <footer className="source-pagination"><span>{total === 0 ? 0 : offset + 1}〜{Math.min(offset + pageSize, total)}件 / 全{total.toLocaleString("ja-JP")}件</span><div><button onClick={() => void loadSources(Math.max(0, offset - pageSize))} disabled={loading || offset === 0}><ChevronLeft />前へ</button><strong>{Math.floor(offset / pageSize) + 1} / {Math.max(1, Math.ceil(total / pageSize))}</strong><button onClick={() => void loadSources(offset + pageSize)} disabled={loading || offset + pageSize >= total}>次へ<ChevronRight /></button></div></footer>
      </section>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<RootApp />);
