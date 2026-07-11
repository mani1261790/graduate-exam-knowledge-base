import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Database,
  ExternalLink,
  FilePlus2,
  GitBranch,
  GraduationCap,
  Home,
  LockKeyhole,
  LogOut,
  Play,
  Search,
  Settings,
  Target,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Concept, Problem, ProblemDetail, Recommendation, SourceDocument, User } from "./types";
import { SolveWorkspacePage } from "./SolveWorkspace";
import "./styles.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDFJS_ASSET_BASE = "/pdfjs";

type View = "home" | "concepts" | "recommendations" | "admin";

const STATUS_LABELS: Record<string, string> = {
  reviewed: "確認済み",
  candidate: "確認待ち",
  draft: "下書き",
  duplicate: "重複",
  deprecated: "非表示",
};

const MODE_LABELS: Record<string, string> = {
  normal: "今日の演習",
  review: "復習",
  foundation: "基礎固め",
  challenge: "挑戦",
};

const ACCESS_SCOPE_LABELS: Record<string, string> = {
  internal_only: "内部利用",
  source_link_only: "リンク参照",
  public_ready: "公開可",
  restricted: "制限あり",
};

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

function recommendationReason(reason: string) {
  return reason
    .replaceAll("弱点Concept", "苦手分野")
    .replaceAll("Concept", "分野")
    .replaceAll("通常推薦", "今日の演習")
    .replaceAll("復習期限", "復習時期");
}

function pdfPageUrl(url: string | null | undefined, page?: number | null) {
  if (!url) return "";
  const [base] = url.split("#");
  return page ? `${base}#page=${page}` : base;
}

function rawProblemPdfUrl(problemId: string) {
  return `/api/problem-pdf?id=${encodeURIComponent(problemId)}`;
}

function problemPdfUrl(problem: Pick<Problem, "id" | "source_url" | "page_start">) {
  if (!problem.source_url) return "";
  return rawProblemPdfUrl(problem.id);
}

function problemPdfOpenUrl(problem: Pick<Problem, "id" | "source_url" | "page_start">) {
  if (!problem.source_url) return "";
  const params = new URLSearchParams({ pdf: "1", id: problem.id });
  if (problem.page_start) params.set("page", String(problem.page_start));
  return `/?${params.toString()}`;
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
  const [view, setView] = useState<View>("home");
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
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [progress, setProgress] = useState<Array<Concept & { evidence_count: number; review_due_at: string | null }>>([]);
  const [mode, setMode] = useState("normal");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (view === "recommendations") void loadRecommendations(mode);
  }, [view, mode]);

  async function bootstrap() {
    try {
      setBusy(true);
      const session = await api.session();
      const [conceptData, problemData, recommendationData, progressData] = await Promise.all([
        api.concepts(),
        api.problems(new URLSearchParams()),
        api.recommendations("normal"),
        api.progress(),
      ]);
      setUser(session.user);
      setConcepts(conceptData.concepts);
      setProblems(problemData.problems);
      setRecommendations(recommendationData.recommendations);
      setProgress(progressData.progress);
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

  async function selectProblem(id: string) {
    const { problem } = await api.problem(id);
    setSelectedProblem(problem);
  }

  async function openProblem(id: string) {
    await selectProblem(id);
    setProblemModalOpen(true);
  }

  async function loadRecommendations(nextMode = mode) {
    const { recommendations: next } = await api.recommendations(nextMode);
    setRecommendations(next);
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
          <NavButton active={view === "recommendations"} icon={<Target />} label="おすすめ演習" onClick={() => setView("recommendations")} />
          <NavButton active={view === "admin"} icon={<Settings />} label="資料管理" onClick={() => setView("admin")} />
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
              placeholder="固有値、Union-Find、木の証明っぽいやつ"
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
            recommendations={recommendations}
            weakConcepts={weakConcepts}
            progress={progress}
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

        {!authRequired && view === "recommendations" && (
          <RecommendationView
            mode={mode}
            recommendations={recommendations}
            onMode={setMode}
            onSelect={openProblem}
          />
        )}

        {!authRequired && view === "admin" && <AdminPanel onCreated={bootstrap} />}
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

  const pdfUrl = problem ? problemPdfUrl(problem) : problemId ? rawProblemPdfUrl(problemId) : "";
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
      {pdfUrl && !busy && !error ? (
        <BlobPdfViewer sourceUrl={pdfUrl} pageNumber={pageNumber} fallbackUrl={originalPdfUrl || pdfUrl} title={`${problem?.problem_label ?? "問題"} PDF`} />
      ) : null}
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
  recommendations,
  weakConcepts,
  progress,
  onProblem,
  onView,
}: {
  user: User | null;
  recommendations: Recommendation[];
  weakConcepts: Concept[];
  progress: Array<Concept & { evidence_count: number; review_due_at: string | null }>;
  onProblem: (id: string) => Promise<void>;
  onView: (view: View) => void;
}) {
  return (
    <section className="dashboard-grid">
      <div className="dashboard-welcome span-2">
        <div>
          <span className="dashboard-eyebrow">PERSONAL STUDY PLAN</span>
          <h1>{user?.display_name ?? "学習者"}さん、今日の演習を始めましょう</h1>
          <p>
            {user?.department
              ? `${user.department}に近い出題分野と、これまでの学習記録から優先問題を選んでいます。`
              : "所属を登録すると、専門分野に近い問題を優先して提案できます。"}
          </p>
        </div>
        <div className={user?.department ? "department-card" : "department-card unregistered"}>
          <GraduationCap />
          <span>現在の所属</span>
          <strong>{user?.department ?? "未登録"}</strong>
        </div>
      </div>
      <div className="panel span-2">
        <PanelTitle icon={<Target />} title={user?.department ? `${user.department}のあなたにおすすめ` : "今日解くとよい問題"} action="すべて見る" onAction={() => onView("recommendations")} />
        <div className="recommendation-list">
          {recommendations.length === 0 ? <span className="muted dashboard-empty">条件に合う問題を準備中です。</span> : null}
          {recommendations.slice(0, 4).map((problem) => (
            <button key={problem.id} className="recommendation-row" onClick={() => void onProblem(problem.id)}>
              <div>
                <strong>{problem.university} {problem.exam_year} {problem.problem_label}</strong>
                <span>{problemSummary(problem)}</span>
                <span className="recommendation-reasons">
                  {problem.reasons.slice(0, 2).map((reason) => <em key={reason}>{recommendationReason(reason)}</em>)}
                </span>
              </div>
              {problem.completed ? <CompletedMark /> : null}
              <meter min={0} max={1} value={problem.score} />
            </button>
          ))}
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
  const pdfUrl = problemPdfUrl(problem);
  const pdfOpenUrl = problemPdfOpenUrl(problem);
  const pdfPageNumber = problem.page_start ?? 1;
  const editable = canEditProblem(user);
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
      <section className="pdf-block">
        <div className="pdf-toolbar">
          <div>
            <strong>問題PDF</strong>
            <span>{pageLabel(problem)}を開いています</span>
          </div>
        </div>
        {pdfUrl ? (
          <BlobPdfViewer sourceUrl={pdfUrl} pageNumber={pdfPageNumber} fallbackUrl={pdfOpenUrl} title={`${problem.problem_label} PDF`} />
        ) : (
          <div className="pdf-missing">この問題にはPDFリンクがまだ登録されていません。</div>
        )}
      </section>
      {problem.statement_text ? (
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
              {attempt.note ? <p>{attempt.note}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function BlobPdfViewer({ sourceUrl, pageNumber = 1, fallbackUrl, title }: { sourceUrl: string; pageNumber?: number; fallbackUrl?: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPdf() {
      setLoading(true);
      setError(null);
      try {
        loadingTask = pdfjsLib.getDocument({
          url: sourceUrl,
          cMapPacked: true,
          cMapUrl: `${PDFJS_ASSET_BASE}/cmaps/`,
          iccUrl: `${PDFJS_ASSET_BASE}/iccs/`,
          standardFontDataUrl: `${PDFJS_ASSET_BASE}/standard_fonts/`,
          wasmUrl: `${PDFJS_ASSET_BASE}/wasm/`,
          rangeChunkSize: 256 * 1024,
        });
        pdfDocument = await loadingTask.promise;
        if (cancelled) return;

        const visiblePageNumber = Math.max(1, Math.min(pdfDocument.numPages, pageNumber));
        const page = await pdfDocument.getPage(visiblePageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("PDF canvas is not available");

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(320, (canvas.parentElement?.clientWidth ?? 960) - 32);
        const scale = Math.min(1.7, Math.max(0.9, availableWidth / baseViewport.width));
        const deviceScale = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale });
        const renderViewport = page.getViewport({ scale: scale * deviceScale });

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        await renderTask.promise;
      } catch (renderError) {
        console.error("PDF preview failed", renderError);
        if (!cancelled) setError("PDFを表示できませんでした");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [pageNumber, sourceUrl]);

  if (error) {
    return (
      <div className="pdf-viewer-shell">
        <div className="pdf-fallback-panel">
          <strong>{error}</strong>
          <a href={fallbackUrl ?? sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />別タブで開く</a>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-shell">
      {loading ? <div className="pdf-state">PDFを読み込んでいます。</div> : null}
      <canvas ref={canvasRef} className="pdf-canvas" aria-label={title} />
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

function RecommendationView({
  mode,
  recommendations,
  onMode,
  onSelect,
}: {
  mode: string;
  recommendations: Recommendation[];
  onMode: (mode: string) => void;
  onSelect: (id: string) => Promise<void>;
}) {
  return (
    <section className="recommendation-page">
      <div className="panel">
        <PanelTitle icon={<Target />} title="おすすめ演習" />
        <div className="segmented">
          {["normal", "review", "foundation", "challenge"].map((item) => (
            <button key={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}>{labelOf(MODE_LABELS, item)}</button>
          ))}
        </div>
        <div className="problem-list">
          {recommendations.map((problem) => (
            <button key={problem.id} className="problem-row" onClick={() => void onSelect(problem.id)}>
              <div className="row-meta">
                <span>{problem.university}</span>
                <span>おすすめ度 {Math.round(problem.score * 100)}</span>
                <span>{pageLabel(problem)}</span>
              </div>
              <strong>{problem.subject_raw ?? problem.problem_label}</strong>
              <span className="problem-summary">{problemSummary(problem)}</span>
              <span className="muted">{problem.reasons.map(recommendationReason).join(" / ")}</span>
              {problem.completed ? <CompletedMark /> : null}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CompletedMark() {
  return <span className="problem-completed" aria-label="解答済み" title="解答済み"><CheckCircle2 /></span>;
}

function AdminPanel({ onCreated }: { onCreated: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState("");
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [stats, setStats] = useState<{ total: number; byUniversity: Array<{ university: string; count: number }>; byScope: Array<{ access_scope: string; count: number }> } | null>(null);

  useEffect(() => {
    void refreshSources();
  }, []);

  async function refreshSources() {
    const [sourceData, statData] = await Promise.all([api.sources(), api.sourceStats()]);
    setSources(sourceData.sources);
    setStats(statData);
  }

  async function createManualSource() {
    const result = await api.createSource({
      source_type: "manual_input",
      title: "手入力資料",
      university: "未設定大学",
      exam_year: 2026,
      file_hash: `manual-${Date.now()}`,
      storage_path: "manual/admin-input.txt",
      access_scope: "internal_only",
    });
    setSourceId(result.id);
    setStatus(`資料を作成しました: ${result.id}`);
    await refreshSources();
    await onCreated();
  }

  async function createSampleProblem() {
    const result = await api.createProblem({
      source_document_id: sourceId,
      problem_label: "管理画面サンプル",
      statement_text: "分野タグ付け待ちのサンプル問題。",
      difficulty: 2,
      estimated_minutes: 15,
      answer_format: "derivation",
      status: "candidate",
    });
    setStatus(`問題を作成しました: ${result.id}`);
    await onCreated();
  }

  return (
    <section className="admin-grid">
      <div className="panel">
        <PanelTitle icon={<FilePlus2 />} title="資料を登録" />
        <p className="muted">過去問PDFや手入力した問題元を、大学院・年度と一緒に登録します。</p>
        <button onClick={() => void createManualSource()}>手入力の資料を作成</button>
      </div>
      <div className="panel">
        <PanelTitle icon={<BookOpen />} title="問題を登録" />
        <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="資料ID" />
        <button onClick={() => void createSampleProblem()} disabled={!sourceId}>サンプル問題を作成</button>
      </div>
      <div className="panel span-2">
        <PanelTitle icon={<ChevronRight />} title="公開前チェック" />
        <p>問題を学習者に出すには、本文、分野タグ、難易度、想定時間、重複チェックをそろえて確認済みにします。</p>
        {status && <div className="notice">{status}</div>}
      </div>
      <div className="panel span-2">
        <PanelTitle icon={<Database />} title="登録済み資料" action="更新" onAction={() => void refreshSources()} />
        <div className="source-stats">
          <strong>{stats?.total ?? sources.length}件の資料</strong>
          {stats?.byScope.map((item) => (
            <span key={item.access_scope}>{labelOf(ACCESS_SCOPE_LABELS, item.access_scope)}: {item.count}</span>
          ))}
        </div>
        <div className="university-grid">
          {stats?.byUniversity.slice(0, 12).map((item) => (
            <div key={item.university}>
              <span>{item.university}</span>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
        <div className="source-table">
          {sources.slice(0, 30).map((source) => (
            <a key={source.id} href={source.source_url ?? "#"} target="_blank" rel="noreferrer">
              <span>{source.university} {source.exam_year}</span>
              <strong>{source.title}</strong>
              <em>{labelOf(ACCESS_SCOPE_LABELS, source.access_scope)}</em>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<RootApp />);
