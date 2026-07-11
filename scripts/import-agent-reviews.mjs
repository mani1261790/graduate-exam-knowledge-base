#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REVIEWS_DIR = path.join(ROOT, "data", "agent-review", "reviews");
const DEFAULT_SOURCES_PATH = path.join(ROOT, "data", "crawl", "sources.json");
const DEFAULT_SQL_PATH = path.join(ROOT, "data", "agent-review", "import_reviews.sql");

const VALID_ANSWER_FORMATS = new Set([
  "multiple_choice",
  "numeric",
  "short_text",
  "proof",
  "derivation",
  "programming",
  "essay",
  "mixed",
]);

const CONCEPTS = [
  ["con_linear_algebra", "node_con_linear_algebra", ["線形代数", "linear algebra", "行列", "ベクトル空間"]],
  ["con_matrix_rank", "node_con_matrix_rank", ["ランク", "matrix rank", "階数", "rank", "列空間", "零空間", "kernel"]],
  ["con_determinant", "node_con_determinant", ["行列式", "determinant", "det", "余因子展開", "可逆性"]],
  ["con_eigenvalue", "node_con_eigenvalue", ["固有値", "eigenvalue", "eigenvalues", "固有ベクトル", "eigenvectors", "matrix eigenvalues", "特性多項式", "特性根"]],
  ["con_diagonalization", "node_con_diagonalization", ["対角化", "diagonalization", "対角化可能", "固有空間"]],
  ["con_conditional_probability", "node_con_conditional_probability", ["条件付き確率", "conditional probability", "ベイズ", "独立性", "条件付き"]],
  ["con_graph", "node_con_graph", ["グラフ理論", "graph theory", "木", "連結", "閉路", "全域木"]],
  ["con_graph_search", "node_con_graph_search", ["グラフ探索", "graph search", "bfs", "dfs", "最短路", "連結成分"]],
  ["con_dp", "node_con_dp", ["動的計画法", "dynamic programming", "dp", "漸化式", "ナップサック", "lcs"]],
  ["con_union_find", "node_con_union_find", ["union-find", "disjoint set union", "素集合データ構造", "dsu", "経路圧縮", "kruskal"]],
  ["con_ordinary_differential_equation", "node_con_ordinary_differential_equation", ["常微分方程式", "ordinary differential equations", "ordinary differential equation", "ode", "微分方程式"]],
  ["con_initial_value_problem", "node_con_initial_value_problem", ["初期値問題", "initial value problem", "ivp"]],
  ["con_periodic_solution", "node_con_periodic_solution", ["周期解", "periodic solution", "周期関数"]],
  ["con_riccati_equation", "node_con_riccati_equation", ["Riccati equation", "リッカチ方程式", "Riccati differential equation"]],
  ["con_recurrence_relation", "node_con_recurrence_relation", ["漸化式", "recurrence", "recurrence relation", "再帰式"]],
  ["con_probability_inequality", "node_con_probability_inequality", ["確率不等式", "probability inequality", "tail bound", "tail bounds"]],
  ["con_expectation", "node_con_expectation", ["期待値", "expectation", "expected value", "分散"]],
  ["con_correlation", "node_con_correlation", ["相関係数", "correlation coefficient", "相関", "共分散"]],
  ["con_geometric_transformation", "node_con_geometric_transformation", ["幾何変換", "geometric transformation", "mirror transformation", "鏡映", "直線"]],
  ["con_calculus", "node_con_calculus", ["微分積分", "calculus", "微分", "積分", "極限", "導関数"]],
  ["con_change_of_variables", "node_con_change_of_variables", ["変数変換", "change of variables", "置換積分", "座標変換"]],
  ["con_multivariable_calculus", "node_con_multivariable_calculus", ["多変数微分積分", "multivariable calculus", "偏微分", "重積分", "多重積分", "double integrals", "spherical coordinates", "Jacobian", "勾配"]],
  ["con_series", "node_con_series", ["級数", "series", "テイラー展開", "Taylor series", "べき級数"]],
  ["con_complex_analysis", "node_con_complex_analysis", ["複素関数", "complex analysis", "留数", "正則関数", "複素積分"]],
  ["con_fourier_analysis", "node_con_fourier_analysis", ["フーリエ解析", "Fourier analysis", "フーリエ級数", "フーリエ変換"]],
  ["con_statistics", "node_con_statistics", ["統計", "statistics", "推定", "検定", "分布", "sample variance", "confidence intervals", "statistical tests", "correlation", "principal component analysis", "R programming"]],
  ["con_probability_statistics", "node_con_probability_statistics", ["確率統計", "probability and statistics", "確率・統計", "数理統計"]],
  ["con_probability", "node_con_probability", ["確率", "probability", "確率分布", "確率過程", "確率変数", "exponential distribution", "independence", "Bayesian inference"]],
  ["con_combinatorics", "node_con_combinatorics", ["組合せ", "combinatorics", "数え上げ", "包除原理", "順列"]],
  ["con_number_theory", "node_con_number_theory", ["整数論", "number theory", "合同式", "剰余", "最大公約数"]],
  ["con_analysis", "node_con_analysis", ["解析", "analysis", "実解析", "関数解析", "pointwise convergence", "uniform convergence", "improper integrals"]],
  ["con_topology", "node_con_topology", ["位相", "topology", "連結性", "開集合", "閉集合"]],
  ["con_algebra", "node_con_algebra", ["代数", "algebra", "抽象代数", "多項式"]],
  ["con_group_theory", "node_con_group_theory", ["群論", "group theory", "群", "準同型", "subgroups", "normal subgroups", "quotient groups"]],
  ["con_inequality", "node_con_inequality", ["不等式", "inequality", "評価", "上界", "下界"]],
  ["con_proof_method", "node_con_proof_method", ["証明", "proof method", "proof", "反例", "counterexample", "背理法"]],
  ["con_convexity", "node_con_convexity", ["凸性", "convexity", "凸関数", "concavity"]],
  ["con_matrix_exponential", "node_con_matrix_exponential", ["行列指数関数", "matrix exponential", "指数関数", "行列の指数関数"]],
  ["con_subspace", "node_con_subspace", ["部分空間", "subspace", "不変部分空間", "線形部分空間", "orthonormal bases", "projection matrices"]],
  ["con_logic", "node_con_logic", ["論理", "logic", "命題論理", "述語論理", "真理値表", "Boolean algebra", "logic minimization", "NAND gates", "sequential circuits"]],
  ["con_set_theory", "node_con_set_theory", ["集合", "set theory", "写像", "同値関係", "関係"]],
  ["con_discrete_math", "node_con_discrete_math", ["離散数学", "discrete mathematics", "離散構造"]],
  ["con_algorithm", "node_con_algorithm", ["アルゴリズム", "algorithm", "algorithm design", "正当性", "擬似コード"]],
  ["con_algorithm_complexity", "node_con_algorithm_complexity", ["計算量", "algorithm complexity", "time complexity", "空間計算量", "オーダー記法"]],
  ["con_sorting", "node_con_sorting", ["ソート", "sorting", "整列", "クイックソート", "quicksort", "マージソート"]],
  ["con_shortest_path", "node_con_shortest_path", ["最短路", "shortest path", "Dijkstra", "ダイクストラ", "Bellman-Ford"]],
  ["con_minimum_spanning_tree", "node_con_minimum_spanning_tree", ["最小全域木", "minimum spanning tree", "MST", "Kruskal", "Prim"]],
  ["con_network_flow", "node_con_network_flow", ["ネットワークフロー", "network flow", "最大流", "max flow", "最小カット"]],
  ["con_data_structure", "node_con_data_structure", ["データ構造", "data structure", "ヒープ", "スタック", "キュー", "二分探索木"]],
  ["con_automata_language", "node_con_automata_language", ["オートマトン", "automata", "形式言語", "regular language", "正規言語", "文脈自由文法"]],
  ["con_information_theory", "node_con_information_theory", ["情報理論", "information theory", "情報量", "エントロピー", "符号化", "相互情報量"]],
  ["con_database", "node_con_database", ["データベース", "database", "SQL", "正規化", "関係データベース", "トランザクション"]],
  ["con_operating_system", "node_con_operating_system", ["オペレーティングシステム", "operating system", "OS", "プロセス", "スレッド", "メモリ管理"]],
  ["con_computer_network", "node_con_computer_network", ["コンピュータネットワーク", "computer network", "network", "TCP", "IP", "ルーティング"]],
  ["con_computer_architecture", "node_con_computer_architecture", ["計算機アーキテクチャ", "computer architecture", "CPU", "キャッシュ", "パイプライン"]],
  ["con_programming_language", "node_con_programming_language", ["プログラミング言語", "programming language", "型システム", "構文解析", "意味論", "C programming", "program tracing"]],
  ["con_software_engineering", "node_con_software_engineering", ["ソフトウェア工学", "software engineering", "設計", "テスト", "要求分析"]],
  ["con_information_system", "node_con_information_system", ["情報システム", "information system", "システム設計", "情報管理"]],
  ["con_human_computer_interaction", "node_con_human_computer_interaction", ["ヒューマンインタフェース", "human-computer interaction", "HCI", "ユーザインタフェース", "ユーザビリティ"]],
  ["con_machine_learning", "node_con_machine_learning", ["機械学習", "machine learning", "回帰", "分類", "最適化", "ニューラルネットワーク"]],
  ["con_evaluation_method", "node_con_evaluation_method", ["評価方法", "evaluation method", "評価指標", "実験計画"]],
  ["con_risk_management", "node_con_risk_management", ["リスク管理", "risk management", "リスク評価", "安全性"]],
  ["con_optimization", "node_con_optimization", ["最適化", "optimization", "線形計画", "凸最適化", "ラグランジュ"]],
  ["con_linear_programming", "node_con_linear_programming", ["線形計画法", "linear programming", "LP", "シンプレックス法"]],
  ["con_game_theory", "node_con_game_theory", ["ゲーム理論", "game theory", "ナッシュ均衡", "戦略形ゲーム"]],
  ["con_numerical_analysis", "node_con_numerical_analysis", ["数値計算", "numerical analysis", "数値解析", "数値解法"]],
  ["con_laplace_transform", "node_con_laplace_transform", ["ラプラス変換", "Laplace transform", "逆ラプラス変換", "伝達関数法"]],
  ["con_discrete_signal_transform", "node_con_discrete_signal_transform", ["離散信号変換", "discrete signal transform", "離散フーリエ変換", "DFT", "FFT", "Z変換", "z-transform", "離散時間システム"]],
  ["con_multiresolution_analysis", "node_con_multiresolution_analysis", ["多重解像度表現", "multiresolution analysis", "multi-resolution representation", "ウェーブレット", "wavelet", "wavelet transform", "時間周波数解析", "短時間フーリエ変換", "STFT"]],
  ["con_signal_processing", "node_con_signal_processing", ["信号処理", "signal processing", "フィルタ", "畳み込み", "サンプリング"]],
  ["con_control_theory", "node_con_control_theory", ["制御", "control theory", "状態方程式", "安定性", "フィードバック"]],
  ["con_electric_circuit", "node_con_electric_circuit", ["電気回路", "electric circuit", "circuit analysis", "回路解析"]],
  ["con_electromagnetism", "node_con_electromagnetism", ["電磁気学", "electromagnetism", "電磁場", "Maxwell equations", "electric current", "magnetic field", "magnetic moment", "electromagnetic induction", "coaxial capacitors", "dielectrics", "parallel-plate capacitors", "DC circuits", "AC circuits", "RLC circuits", "transient response"]],
  ["con_differential_geometry", "node_con_differential_geometry", ["微分幾何", "differential geometry", "parametric surfaces", "first fundamental form", "curvature"]],
  ["con_classical_mechanics", "node_con_classical_mechanics", ["力学", "classical mechanics", "rigid body dynamics", "equations of motion", "constraints", "oscillation"]],
  ["con_thermodynamics", "node_con_thermodynamics", ["熱力学", "thermodynamics", "thermodynamic potentials", "Maxwell relations", "state variables", "second law", "Clausius inequality", "Maxwell speed distribution", "statistical mechanics"]],
  ["con_quantum_mechanics", "node_con_quantum_mechanics", ["量子力学", "quantum mechanics", "localized wave packets", "uncertainty", "operators", "time evolution", "particle in a box", "quantum states", "harmonic oscillator", "ladder operators", "energy eigenstates", "commutators", "quantum numbers"]],
  ["con_solid_state_physics", "node_con_solid_state_physics", ["固体物理", "solid state physics", "band structure", "semiconductors", "two-dimensional electron gas", "reciprocal space", "density of states", "Fermi energy"]],
  ["con_general_chemistry", "node_con_general_chemistry", ["化学", "general chemistry", "stoichiometry", "SI units", "atomic orbitals", "electronegativity", "Lewis structures", "reaction enthalpy", "Gibbs energy", "acid-base equilibria", "molecular motion", "formal charge", "atomic radius", "molecular geometry", "dipole moments", "electron configuration", "electron configuration rules", "bonding", "molecular orbitals", "molecular orbital diagrams", "chemical equilibrium", "thermodynamics", "standard formation quantities"]],
  ["con_organic_chemistry", "node_con_organic_chemistry", ["有機化学", "organic chemistry", "E1 reaction", "E2 reaction", "organic reaction mechanisms", "oxoanion substitution", "acidity", "stereochemistry", "reaction prediction", "multistep synthesis", "resonance", "radical bromination", "synthetic transformations", "aromatic substitution", "constitutional isomers", "IUPAC nomenclature", "alkyl halide reactions", "amine basicity", "elimination stereochemistry", "addition reactions", "ring-opening polymerization"]],
  ["con_inorganic_chemistry", "node_con_inorganic_chemistry", ["無機化学", "inorganic chemistry", "transition-metal terms", "crystal field theory", "coordination complexes", "coordination stereochemistry", "crystal field splitting"]],
  ["con_analytical_chemistry", "node_con_analytical_chemistry", ["分析化学", "analytical chemistry", "electrochemistry", "EDTA titration", "metal indicators", "buffer equilibrium", "Henderson-Hasselbalch equation"]],
  ["con_physical_chemistry", "node_con_physical_chemistry", ["物理化学", "physical chemistry", "reaction kinetics", "photophysical processes", "Jablonski diagram", "photophysics", "fluorescence lifetime", "Raman scattering", "NMR spectroscopy", "surface adsorption equilibrium", "phase diagrams"]],
  ["con_earth_materials", "node_con_earth_materials", ["地球材料", "earth materials", "feldspar", "crystallization", "igneous rocks"]],
  ["con_polymer_science", "node_con_polymer_science", ["高分子科学", "polymer science", "viscoelasticity", "rubber elasticity", "polymer optics", "refractive index dispersion"]],
  ["con_molecular_biology", "node_con_molecular_biology", ["分子生物学", "molecular biology", "histone modification", "amino acid ionization", "GAPDH reaction", "NADH", "DNA as genetic material", "DNA amount calculation", "mRNA purification", "RNA polymerases", "transcription termination", "protein modification"]],
  ["con_cell_biology", "node_con_cell_biology", ["細胞生物学", "cell biology", "fertilization", "cell junctions", "apoptosis DNA ladder", "carbohydrates", "glycoproteins", "enzyme classification", "Michaelis-Menten kinetics", "competitive inhibition"]],
  ["con_architectural_planning", "node_con_architectural_planning", ["建築計画", "architectural planning", "housing standards", "universal design", "architectural design", "guesthouse planning", "restaurant planning", "site context", "riverfront design", "library architecture", "collection growth", "floor planning", "management requirements", "proposal writing"]],
  ["con_urban_planning", "node_con_urban_planning", ["都市計画", "urban planning", "urban planning terms", "都市デザイン", "景観", "neighborhood parks", "park scale", "public space management", "urban park policy", "urban landscape issues", "planning controls", "landscape policy"]],
  ["con_architectural_history", "node_con_architectural_history", ["建築史", "architectural history", "Japanese architecture", "Gothic architecture", "Secession movement", "Japanese Buddhist temples", "garan layout", "Asuka period", "Nara period architecture"]],
  ["con_structural_engineering", "node_con_structural_engineering", ["構造工学", "structural engineering", "section moment of inertia", "cantilever beam", "deflection", "structural sections", "wood construction", "steel construction", "reinforced concrete formwork", "static and indeterminate structures", "arches and cables", "frame deformation", "reinforced concrete beams"]],
  ["con_building_environment", "node_con_building_environment", ["建築環境工学", "building environment", "solar radiation", "vision", "architectural acoustics", "water supply systems", "ventilation", "lighting environment", "heat pumps", "data centers", "thermal resistance", "lighting calculations", "roofing", "concrete admixtures"]],
  ["con_medical_informatics", "node_con_medical_informatics", ["医療情報", "medical informatics", "医療データ", "ヘルスケア情報"]],
  ["con_ecology", "node_con_ecology", ["生態学", "ecology", "個体群", "生物多様性"]],
  ["con_evolution", "node_con_evolution", ["進化", "evolution", "進化モデル", "系統"]],
];

CONCEPTS.push(
  ["con_operations_research", "node_con_operations_research", ["オペレーションズリサーチ", "operations research", "OR", "数理モデル", "数理計画"]],
  ["con_sequence", "node_con_sequence", ["数列", "sequence", "数列の極限", "数学的帰納法", "mathematical induction"]],
  ["con_basis", "node_con_basis", ["基底", "basis", "basis vectors", "ベクトル"]],
  ["con_inverse_matrix", "node_con_inverse_matrix", ["逆行列", "inverse matrix", "連立一次方程式", "linear systems"]],
  ["con_numerical_iteration", "node_con_numerical_iteration", ["反復法", "iterative method", "数値解法", "numerical method"]],
  ["con_mathematical_foundations", "node_con_mathematical_foundations", ["基礎数学", "応用数学", "mathematical foundations", "特殊関数", "多変数関数"]],
  ["con_computer_fundamentals", "node_con_computer_fundamentals", ["計算機基礎", "情報科学", "computer fundamentals", "データ表現", "2進数", "機械語", "アセンブリ", "メモリ", "入出力", "ハッシュ"]],
  ["con_digital_logic", "node_con_digital_logic", ["論理回路", "digital logic", "デジタル回路", "combinational logic"]],
  ["con_information_communication", "node_con_information_communication", ["情報通信", "通信方式", "information communication", "伝送線路", "ネットワーク", "OSI参照モデル", "L2スイッチ", "IPアドレス", "TCP throughput", "routing algorithms", "bit errors", "DHCP"]],
  ["con_coding_theory", "node_con_coding_theory", ["符号理論", "coding theory", "source coding", "instantaneous codes", "binary code design", "entropy"]],
  ["con_signal_systems", "node_con_signal_systems", ["システム解析", "周波数応答", "周波数解析", "デジタルフィルタ", "ディジタル信号処理", "デジタル信号処理", "ディジタル信号", "ブロック線図", "信号システム", "線形システム", "通信システム", "振幅位相", "小信号解析", "小信号等価回路"]],
  ["con_maclaurin_series", "node_con_maclaurin_series", ["マクローリン展開", "Maclaurin series", "Taylor expansion"]],
  ["con_probability_models", "node_con_probability_models", ["確率モデル", "probability model", "ベイズ推定", "信頼区間"]],
  ["con_physics", "node_con_physics", ["物理学", "physics", "エネルギー", "放射性同位体"]],
  ["con_electromagnetic_waves", "node_con_electromagnetic_waves", ["電磁波", "electromagnetic waves", "電場", "電界", "磁界", "静電場", "誘電体", "コンデンサ", "円筒導体", "電流密度", "電磁誘導"]],
  ["con_electronics", "node_con_electronics", ["電子工学", "電子回路", "電子デバイス", "トランジスタ", "電気機器", "回転機", "変圧器", "ブリッジ回路", "インピーダンス", "電力変換", "直流回路", "交流回路", "過渡現象"]],
  ["con_materials_mechanics", "node_con_materials_mechanics", ["材料力学", "はり", "片持ちはり", "応力", "曲げ", "たわみ", "材料特性"]],
  ["con_mechanical_dynamics", "node_con_mechanical_dynamics", ["機械力学", "剛体", "振動", "回転振動", "二自由度振動", "運動方程式", "仕事", "運動量"]],
  ["con_fluid_mechanics", "node_con_fluid_mechanics", ["流体力学", "ベルヌーイの定理", "粘性流体", "流れ", "管内流れ", "噴流", "次元解析"]],
  ["con_control_engineering", "node_con_control_engineering", ["制御工学", "伝達関数", "過渡応答", "ラプラス変換"]],
  ["con_heat_engineering", "node_con_heat_engineering", ["熱機関", "サイクル", "カルノーサイクル", "熱移動", "エネルギー変換", "燃焼"]],
  ["con_condensed_matter", "node_con_condensed_matter", ["物性物理", "光物性", "半導体", "量子化学"]],
  ["con_chemical_structure", "node_con_chemical_structure", ["化学構造", "分子構造", "原子軌道", "錯体化学", "立体化学", "相平衡", "反応速度", "反応機構"]],
  ["con_environmental_engineering", "node_con_environmental_engineering", ["環境工学", "水環境", "上下水道", "浄水処理", "排水処理", "廃棄物処理", "資源循環", "資源エネルギー", "ごみ発電", "バイオマス", "生物環境", "日射量", "GIS", "地球温暖化", "水質モデル", "物質収支", "アナモックス", "PFAS"]],
  ["con_life_science", "node_con_life_science", ["生命科学", "生命工学", "遺伝子", "PCR", "微生物増殖", "生化学", "代謝", "微生物学", "発酵工学", "培養", "生体計測", "生物統計", "環境応答"]],
  ["con_experimental_design", "node_con_experimental_design", ["実験設計", "データ解析", "統計解析", "グラフ読解", "研究計画"]],
  ["con_scientific_english", "node_con_scientific_english", ["科学英語", "化学英語", "英文和訳", "和文英訳", "科学技術英文読解", "専門読解"]],
  ["con_architecture_design", "node_con_architecture_design", ["空間デザイン", "展示施設", "集合住宅", "用語説明", "デザイン論"]],
  ["con_transport_land_use", "node_con_transport_land_use", ["交通計画", "土地利用", "計画論"]],
  ["con_civil_structures", "node_con_civil_structures", ["構造力学", "トラス", "建設材料", "鉄筋コンクリート", "コンクリート特性", "土質力学", "地盤工学", "土圧"]],
  ["con_essay_writing", "node_con_essay_writing", ["小論文", "論述", "専門論述", "proposal writing"]],
  ["con_residue_theorem", "node_con_residue_theorem", ["residue theorem", "留数定理"]],
  ["con_game_sequential_rationality", "node_con_game_sequential_rationality", ["sequential rationality", "逐次合理性"]],
  ["con_set_operations", "node_con_set_operations", ["set intersection", "集合演算"]],
);

CONCEPTS.push(
  ["con_earth_planetary_science", "node_con_earth_planetary_science", ["地球惑星科学", "earth and planetary science", "地球科学", "惑星科学", "地球内部構造", "マントル化学", "海洋元素循環", "火山学", "岩石学", "鉱物同定", "偏光顕微鏡", "同位体", "海洋地形", "プレートテクトニクス", "地質断面", "宇宙化学", "元素合成", "核反応", "恒星進化", "高圧鉱物", "隕石", "コンドライト", "火山活動", "海洋プレート", "地質図", "惑星大気", "炭酸平衡", "鉱物学", "結晶構造", "地球化学", "結晶化学"]],
  ["con_engineering_math", "node_con_engineering_math", ["工業数学", "engineering mathematics", "数学", "複素数", "複素行列", "対称行列", "二次形式", "複素解析", "円筒座標", "多変数解析", "ベクトル解析", "発散定理", "最小二乗", "多変数微分", "極値", "射影行列", "偏微分方程式", "拡散", "拡散方程式", "境界条件", "面積分", "ベクトル場", "極座標", "最大化", "行列べき", "曲線長", "ラプラス方程式", "境界値問題", "生成関数", "関数空間", "級数解", "微分演算子", "微分性質", "数列の収束", "回転変換", "無限級数", "積分計算", "半正定値行列", "グラフ", "連続性", "順序関係", "直交基底", "双対性", "数論", "核", "ヘッセ行列", "標準形", "環論", "体", "コンパクト性", "不定積分", "ガウス積分", "広義積分", "収束", "内積空間", "ノルム", "行列計算"]],
  ["con_differential_equations", "node_con_differential_equations", ["微分方程式", "differential equations", "一般解", "特殊解", "連立微分方程式", "特性方程式", "近似", "誤差"]],
  ["con_statistical_modeling", "node_con_statistical_modeling", ["統計モデリング", "statistical modeling", "多項分布", "正規分布", "指数分布", "モーメント母関数", "標本", "離散分布", "最尤推定", "マルコフ連鎖", "回帰分析", "二項分布", "同時分布", "分布関数", "対数正規分布", "仮説検定", "統計的仮説検定", "カイ二乗分布", "確率母関数"]],
  ["con_mechanics_extended", "node_con_mechanics_extended", ["応用力学", "applied mechanics", "慣性モーメント", "ラグランジアン", "軌道運動", "摂動", "万有引力", "応力ひずみ", "熱応力", "ばね質点系", "センサモデル", "管路流れ", "管路", "翼・噴流", "ひずみ", "破壊", "剛体運動", "粘性流れ", "境界層", "管内流", "熱変形", "ラグランジュ方程式", "流量", "粘性", "圧力損失", "円運動", "振動応答", "非線形力学", "エネルギー法", "摩擦", "塑性変形", "材料強度", "運動", "粒子", "変形"]],
  ["con_thermal_fluid_engineering", "node_con_thermal_fluid_engineering", ["熱流体工学", "thermal and fluid engineering", "黒体放射", "化学熱力学", "Clausius-Clapeyron式", "統計力学", "気体分子運動論", "圧力", "速度分布", "オットーサイクル", "理想気体", "状態変化", "伝熱", "気体サイクル", "冷凍機", "エネルギー収支", "ボルツマン分布", "ヒートポンプ", "流体", "移動現象"]],
  ["con_electromagnetism_extended", "node_con_electromagnetism_extended", ["電磁気", "electromagnetics", "電磁気学", "円板電荷", "電位", "磁束密度", "アンペールの法則", "導体", "同軸線路", "静電容量", "コイル", "相互インダクタンス", "静電エネルギー", "ローレンツ力", "荷電粒子", "電場磁場", "同軸コンデンサ", "電磁界", "ポインティングベクトル", "ガウスの法則", "球対称", "ビオ・サバールの法則", "磁束", "インダクタンス", "磁場"]],
  ["con_electric_circuits_extended", "node_con_electric_circuits_extended", ["電気電子回路", "electric and electronic circuits", "回路", "信号", "インピーダンス整合", "三相交流", "Y-Δ変換", "RLC", "MOSFET", "小信号等価回路", "小信号解析", "回路方程式", "キルヒホッフ則", "RLC回路", "LC回路", "共振", "交流電力", "RC回路", "オペアンプ", "入力インピーダンス"]],
  ["con_quantum_physics_extended", "node_con_quantum_physics_extended", ["量子物理", "quantum physics", "シュレディンガー方程式", "透過率", "波動関数", "摂動論", "二準位系", "エルミート演算子", "階段ポテンシャル", "井戸型ポテンシャル", "束縛状態", "固有状態", "ポテンシャル", "演算子", "サイクロトロン", "ポテンシャル障壁", "波動"]],
  ["con_materials_science_extended", "node_con_materials_science_extended", ["材料科学", "materials science", "物性基礎", "状態密度", "k空間", "キャリア密度", "キャリア", "フェルミ分布", "正孔密度", "電気伝導", "電子顕微鏡", "光吸収", "エネルギー吸収", "物理", "物性", "固体物性", "金属物理学", "無機固体", "バンド構造", "材料物性", "金属組織", "相変態", "無機材料", "固体化学", "転位", "構造", "結晶", "物性物理"]],
  ["con_chemistry_extended", "node_con_chemistry_extended", ["応用化学", "applied chemistry", "化学結合", "混成軌道", "平衡定数", "化学分析", "光化学", "物質量計算", "相図", "化学平衡", "分光分析", "高分子化学", "重合", "芳香族性", "アミノ酸", "酸化還元", "エリンガム図", "錯体", "構造決定", "合成", "状態図", "電子構造", "高分子物性", "変態", "化学工学", "反応工学", "分離工学", "粘弾性", "蒸留"]],
  ["con_economics_management", "node_con_economics_management", ["経済経営", "economics and management", "ミクロ経済学", "一般均衡", "パレート効率", "産業組織論", "均衡", "経済学", "制度設計", "在庫管理", "生産管理", "意思決定", "管理工学", "経営学", "戦略論", "組織論", "会計", "投資評価", "スケジューリング"]],
  ["con_computer_systems_extended", "node_con_computer_systems_extended", ["計算機システム", "computer systems", "浮動小数点", "数値表現", "プログラミング", "計算理論", "デッドロック", "ソフトウェア", "OS更新", "逆ポーランド記法", "有限状態機械", "状態遷移表", "デザインパターン", "State pattern", "演算子優先順位", "探索アルゴリズム", "Python", "ブール代数", "論理式", "ビット列", "可逆変換"]],
  ["con_ai_society", "node_con_ai_society", ["AIと情報社会", "AI and information society", "人工知能", "生成AI", "ChatGPT", "情報社会", "ICT利活用", "技術評価", "リスク分析", "社会影響", "新技術", "研究動向", "essay", "情報セキュリティ", "情報基盤", "教育情報システム", "学習データ", "個人情報", "policy", "ヒューマン情報学", "コミュニケーション技術", "社会的影響", "人間関係", "マルチメディア", "技術受容", "社会実装", "ユーザー価値", "情報数理", "社会課題", "ジオメディア", "位置情報サービス", "事例分析", "利点と課題", "システム提案", "長所短所分析", "デジタルツイン", "データ連携", "倫理", "メタバース", "仮想空間", "社会的普及", "研究事例", "技術事例", "生活変化", "成果評価"]],
);

CONCEPTS.push(
  ["con_mathematical_informatics", "node_con_mathematical_informatics", ["数理情報学", "mathematical informatics", "基礎概念", "定理", "文献調査", "研究計画"]],
  ["con_advanced_optimization", "node_con_advanced_optimization", ["高度最適化", "advanced optimization", "凸解析", "ベイズ最適化", "最小費用流", "近接勾配法", "勾配法", "制約条件", "変分法", "極値問題", "近似評価", "行列不等式", "リアプノフ関数", "最小二乗法", "単調回帰"]],
  ["con_random_processes", "node_con_random_processes", ["確率過程", "stochastic processes", "ランダム行列", "ポアソン分布", "順序統計", "順序統計量", "特性関数", "極限定理", "中央値", "打ち切りデータ", "標本平均", "尤度", "粒子運動"]],
  ["con_dynamical_systems", "node_con_dynamical_systems", ["力学系", "dynamical systems", "爆発解", "感染症モデル", "漸近挙動", "単調性", "安定性"]],
  ["con_graph_algorithms_extended", "node_con_graph_algorithms_extended", ["グラフアルゴリズム", "graph algorithms", "有向グラフ", "線形時間", "貪欲法", "最短路", "到達可能性", "経路", "二分探索", "隣接行列", "彩色", "重み付きグラフ", "定常分布", "ハッシュ表", "四分木", "空間データ構造", "最近傍探索", "アルゴリズム設計", "配列", "連結リスト", "二分木"]],
  ["con_matrix_analysis", "node_con_matrix_analysis", ["行列解析", "matrix analysis", "トレース", "多項式行列", "特異値分解", "特異値", "直交行列", "正定値行列", "行列方程式", "QR分解", "スペクトル", "行列ノルム", "行列冪", "構造化行列", "行列列"]],
  ["con_abstract_algebra_extended", "node_con_abstract_algebra_extended", ["代数構造", "algebraic structures", "可換性", "多項式環", "イデアル", "商環"]],
  ["con_numerical_methods_extended", "node_con_numerical_methods_extended", ["数値解析応用", "applied numerical methods", "数値積分", "差分法", "差分方程式", "離散ラプラシアン", "再帰", "波動方程式"]],
  ["con_real_analysis_extended", "node_con_real_analysis_extended", ["解析応用", "applied analysis", "一様収束", "微分可能性", "関数列", "不動点", "体積", "陰関数", "接線", "収束半径", "距離", "幾何", "積分変換", "母関数", "整数列", "有理関数", "微分作用素", "定数関数", "二重積分", "三角関数", "対数関数", "接平面", "領域積分", "直交多項式", "ルジャンドル多項式", "ベータ関数", "コーシーの積分定理", "零点", "テイラー公式", "確率密度"]],
  ["con_optics_photonics", "node_con_optics_photonics", ["光学・フォトニクス", "optics and photonics", "光学", "干渉", "回折", "光通信", "偏光", "逆格子"]],
  ["con_cryptography_coding", "node_con_cryptography_coding", ["暗号・符号", "cryptography and coding", "暗号", "2の補数", "パリティ検査", "誤り訂正", "ギブスの不等式", "NAND", "整数表現"]],
  ["con_systems_control_extended", "node_con_systems_control_extended", ["制御システム", "systems and control", "最適制御", "状態空間モデル", "PID制御", "制御理論", "ボード線図", "可制御性", "フィードバック制御", "倒立振子", "ラグランジュ法", "デジタル信号処理", "Z変換", "ディジタルフィルタ", "振り子"]],
  ["con_robotics_mechatronics", "node_con_robotics_mechatronics", ["ロボティクス", "robotics", "マニピュレータ", "ヤコビ行列", "仮想仕事", "コンプライアンス", "静力学", "圧電素子", "加速度センサ", "歯車機構", "ロボットアーム", "DCモータ", "巻上機", "衝突", "角運動量", "電動機", "誘導モータ", "磁気浮上", "ロボットハンド"]],
  ["con_machine_learning_extended", "node_con_machine_learning_extended", ["機械学習応用", "applied machine learning", "AI", "拡散モデル", "線形回帰", "人工ニューロン", "線形分類", "パーセプトロン", "超平面", "マージン", "サポートベクターマシン"]],
  ["con_programming_systems_extended", "node_con_programming_systems_extended", ["プログラミングシステム", "programming systems", "C言語", "プログラム読解", "実装方式", "関数ポインタ", "状態遷移"]],
  ["con_computational_biology", "node_con_computational_biology", ["生命情報学", "computational biology", "細胞小器官", "細胞骨格", "シグナル伝達", "生体分子", "DNA複製", "遺伝子発現", "酵素", "ATP", "ゲノム解析", "モータータンパク質", "タンパク質", "細胞内輸送", "酵素反応", "タンパク質構造", "転写制御", "細胞周期", "膜輸送", "DNA修復", "細胞接着", "細胞外マトリックス", "翻訳", "遺伝暗号"]],
);

CONCEPTS.push(
  ["con_information_science_extended", "node_con_information_science_extended", ["情報科学応用", "applied information science", "木構造", "パターン認識", "計算モデル", "データ分析", "探索", "強化学習", "データモデル", "標準化", "論理プログラミング", "Prolog", "関係モデル", "ベイズネットワーク", "画像処理", "情報処理", "セキュリティ", "文字列処理", "R", "統計検定", "多重比較", "単回帰"]],
  ["con_network_communications", "node_con_network_communications", ["ネットワーク通信", "network communications", "通信", "通信ネットワーク", "通信路", "通信方式", "OFDM", "通信プロトコル", "インターネット", "RFID", "標本化", "サンプリング", "変調", "IPv4", "サブネット", "プロトコル", "条件付きエントロピー"]],
  ["con_technical_english", "node_con_technical_english", ["専門英語", "technical English", "英語", "読解", "語彙", "和訳"]],
  ["con_bio_chemistry_extended", "node_con_bio_chemistry_extended", ["生命化学", "biochemistry", "行動生態", "生命化学", "クエン酸回路", "mRNA", "プラスミド", "塩基配列", "膜タンパク質", "RNA干渉", "脂肪酸代謝", "タンパク質精製", "クロマトグラフィー", "生物学"]],
  ["con_physical_information", "node_con_physical_information", ["物理情報", "physical information", "物理情報", "ド・ブロイ波長", "不確定性原理", "X線", "結晶構造解析", "ブラッグの式", "調和振動子", "水素原子", "分子振動", "振動スペクトル", "X線回折"]],
  ["con_chemistry_topics_extended", "node_con_chemistry_topics_extended", ["化学トピック", "chemistry topics", "基礎化学", "電子配置", "マンガン", "配位化学", "ルイス構造", "有機反応", "配座解析", "環境化学", "温室効果気体", "大気化学", "機器分析", "周期表", "化学量論", "溶解度積", "反応生成物", "分子軌道", "ケイ酸塩", "反応速度論", "エンタルピー", "クロスカップリング", "ラジカル重合", "NMR", "電気化学", "SN2反応", "カルボニル化学", "多段階合成", "不斉合成", "多段階変換"]],
  ["con_architecture_urban_design", "node_con_architecture_urban_design", ["建築・都市設計", "architecture and urban design", "建築用語", "日本建築", "西洋建築", "建築構造", "静定梁", "反力", "曲げモーメント", "建築構法", "鉄骨造", "RC造", "建築設備", "日射", "照明", "受電設備", "建築材料", "建築環境", "施工", "省エネルギー", "塑性崩壊", "梁たわみ", "換気", "音響工学", "事務所建築", "ビルディングタイプ", "立地適正化計画", "公共交通", "都市防災", "地震防災", "まちづくり", "西洋建築史", "バロック建築", "建築様式", "建築設計", "即日設計", "学童保育施設", "外構計画"]],
  ["con_social_human_information", "node_con_social_human_information", ["人間社会情報", "human and social information", "心理情報", "社会情報", "ユースケース", "多様性", "疫学", "防災", "地理情報", "アクセシビリティ", "数値モデル", "調査法", "気候変動", "公衆衛生", "音楽", "心理", "卒業研究"]],
  ["con_advanced_math_topics", "node_con_advanced_math_topics", ["発展数学", "advanced mathematics", "有限体", "論理代数", "組合せ回路", "線形写像", "微積分", "可換環論", "剰余環", "曲率", "弧長", "第一基本形式", "ヤコビアン"]],
  ["con_electrical_physics_extended", "node_con_electrical_physics_extended", ["電気物理", "electrical physics", "コンデンサー", "マックスウェル方程式", "過渡解析", "分配関数", "エネルギー測定", "pn接合", "バンド図", "MRI"]],
);

CONCEPTS.push(
  ["con_math_foundations_extended", "node_con_math_foundations_extended", ["数学基礎拡張", "extended mathematical foundations", "射影", "次元", "立体領域", "線形汎関数", "線形変換", "中心極限定理", "単射", "線形結合", "数理科学", "derivation"]],
  ["con_parallel_digital_systems", "node_con_parallel_digital_systems", ["並列・デジタルシステム", "parallel and digital systems", "並列処理", "離散フーリエ変換", "順序回路"]],
  ["con_mechanical_physics_topics", "node_con_mechanical_physics_topics", ["機械物理トピック", "mechanical physics topics", "回転運動", "梁", "ねじり", "ベルヌーイ", "誘導起電力", "光デバイス", "分光"]],
  ["con_psychology_clinical", "node_con_psychology_clinical", ["心理・臨床心理", "psychology and clinical psychology", "心理学", "認知心理学", "社会心理学", "臨床心理学", "心理面接", "遊戯療法", "支援方針", "心理査定", "ロールシャッハ検査", "検査フィードバック", "学生相談", "カウンセリング", "ケース対応", "多職種連携", "支援体制", "職能", "研究法", "research question", "行動科学", "自己モニタリング", "プラセボ効果", "心理療法", "終結", "治療関係", "心理検査", "学校臨床", "不登校", "スクールカウンセリング", "地域援助", "インタビュー", "研究倫理", "自己理解", "ケースフォーミュレーション", "力動的理解", "認知行動療法", "ヒューリスティック", "保護者支援", "ソーシャルサポート", "連携", "バイアス"]],
  ["con_education_social_welfare", "node_con_education_social_welfare", ["教育・福祉", "education and social welfare", "教育学", "特別支援教育", "教育政策", "子どもの権利", "オンライン学習", "福祉", "ソーシャルワーク", "高齢化", "障害", "高齢者福祉", "生涯学習"]],
  ["con_social_management_humanities", "node_con_social_management_humanities", ["社会経営・人文学", "social management and humanities", "社会経営", "社会学", "宗教社会学", "Durkheim", "Weber", "政治学", "法学", "国際関係", "地域文化", "コミュニケーション", "人文学", "哲学", "歴史学", "文学", "言語文化", "人類学", "比較文化", "文化差", "social cohesion", "都市", "美学", "future studies"]],
  ["con_natural_environment_extended", "node_con_natural_environment_extended", ["自然環境科学", "natural environment science", "自然環境", "天文学", "観測データ", "反応", "環境変化", "地質", "気候", "環境社会学", "human environment", "恒星", "観測", "地震", "火山"]],
  ["con_health_global_risk", "node_con_health_global_risk", ["生活健康・グローバルヘルス", "life health and global health", "生活健康", "global health", "SDGs", "リスクコミュニケーション", "健康づくり", "COVID-19", "生殖補助医療"]],
  ["con_academic_reading_writing", "node_con_academic_reading_writing", ["学術読解・論述", "academic reading and writing", "概念説明", "英文要約", "英文読解", "要約", "focus", "mixed"]],
  ["con_neurobiology_extended", "node_con_neurobiology_extended", ["神経生物学", "neurobiology", "神経生物学", "シナプス"]],
);

CONCEPTS.push(
  ["con_classical_math_calculus_more", "node_con_classical_math_calculus_more", ["古典解析・微積分", "classical calculus and analysis", "積分順序の交換", "定積分", "Rolleの定理", "平均値の定理", "三角関数積分", "剰余項", "Taylor展開", "Cauchy評価", "差商", "収束判定", "Fourier積分", "有界性", "解析学", "計算", "測度", "連続関数"]],
  ["con_classical_linear_algebra_more", "node_con_classical_linear_algebra_more", ["古典線形代数", "classical linear algebra", "連立方程式", "実数解", "2次行列", "交換子", "正則行列", "非負行列", "巡回行列", "交代行列", "固有多項式", "表現行列", "Cayley-Hamiltonの定理", "半正定値", "行基本変形", "行ランク", "列ランク"]],
  ["con_classical_math_structures_more", "node_con_classical_math_structures_more", ["数学構造・幾何", "mathematical structures and geometry", "代数計算", "周期数列", "Cauchy-Riemann方程式", "ベイズの定理", "最大値", "因数分解", "数値近似", "立体の体積", "円柱", "球", "楕円体", "恒等式", "Laplacian", "置換", "同型写像", "体論", "微分形式", "ホモロジー", "物理数学", "数理"]],
  ["con_kyoto_systems_more", "node_con_kyoto_systems_more", ["京都情報学系トピック", "Kyoto informatics systems topics", "オペレーションズ・リサーチ", "現代制御", "状態空間", "通信ネットワーク", "アーキテクチャ", "システム", "計算機", "漸近記法", "性能評価", "計測", "デバイス"]],
  ["con_physics_materials_more", "node_con_physics_materials_more", ["物理・物質科学トピック", "physics and materials topics", "解析力学", "物理統計", "ホール効果", "ソレノイド", "格子振動", "比熱", "転がり運動", "熱ひずみ", "物質科学"]],
  ["con_chemistry_earth_more", "node_con_chemistry_earth_more", ["化学・地球科学トピック", "chemistry and earth science topics", "結晶場", "配位子", "天然物合成", "地質学", "地形", "地球物理", "観察"]],
);

CONCEPTS.push(
  ["con_exam_linear_numerical_more", "node_con_exam_linear_numerical_more", ["入試線形代数・数値線形代数", "exam linear and numerical algebra", "Vandermonde行列", "多項式補間", "三重対角行列", "Jacobi法", "数値線形代数", "整数行列", "Hermite標準形"]],
  ["con_exam_analysis_probability_more", "node_con_exam_analysis_probability_more", ["入試解析・確率", "exam analysis and probability", "線形微分方程式", "独立試行", "停止時刻", "解析幾何", "不等式領域", "面積", "パラメータ積分", "微分と積分の交換", "極限計算", "確率論", "一様分布", "確率密度関数", "幾何確率", "面積計算"]],
  ["con_exam_statistics_inference_more", "node_con_exam_statistics_inference_more", ["入試統計推測", "exam statistical inference", "統計的推測", "Fisher情報量", "Cramer-Rao不等式", "不偏推定量", "位置母数"]],
  ["con_exam_algorithms_discrete_more", "node_con_exam_algorithms_discrete_more", ["入試アルゴリズム・離散構造", "exam algorithms and discrete structures", "部分和問題", "記憶量解析", "格子点", "Pickの定理", "マルコフ過程", "近似アルゴリズム", "通信路"]],
  ["con_exam_academic_english_more", "node_con_exam_academic_english_more", ["入試学術英語", "exam academic English", "数学的説明", "数学英語", "和文説明", "物理英語", "内容説明", "英作文", "導出", "総合問題"]],
  ["con_exam_science_society_more", "node_con_exam_science_society_more", ["入試科学・社会トピック", "exam science and society topics", "原子", "統計物理", "物理用語", "がん", "社会科学", "建築", "粘性流", "保存則", "ディジタル信号", "命令実行", "生活健康科学", "健康格差", "地域課題", "宇宙物理"]],
);

function parseArgs(argv) {
  const options = {
    reviewsDir: DEFAULT_REVIEWS_DIR,
    sourcesPath: DEFAULT_SOURCES_PATH,
    sqlPath: DEFAULT_SQL_PATH,
    apply: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--reviews-dir") options.reviewsDir = path.resolve(ROOT, next());
    else if (arg === "--sources") options.sourcesPath = path.resolve(ROOT, next());
    else if (arg === "--sql") options.sqlPath = path.resolve(ROOT, next());
    else if (arg === "--apply-local") options.apply = "local";
    else if (arg === "--apply-remote") options.apply = "remote";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/import-agent-reviews.mjs [options]

Options:
  --reviews-dir <path>  Review JSON directory. Default: data/agent-review/reviews
  --sources <path>      Crawl source JSON. Default: data/crawl/sources.json
  --sql <path>          Generated SQL path. Default: data/agent-review/import_reviews.sql
  --apply-local         Execute the generated SQL against local D1.
  --apply-remote        Execute the generated SQL against remote D1.
  --dry-run             Validate inputs and print a summary without writing SQL.
  -h, --help            Show this help.
`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function hash(value, length = 20) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function sourceId(record) {
  if (record.source_document_id) return String(record.source_document_id);
  const prefix = String(record.target_id).replace(/[^a-zA-Z0-9_]/g, "_");
  return `src_${prefix}_${String(record.file_hash).slice(0, 12)}`;
}

function sourceDocumentKey(record) {
  if (record.file_hash && record.target_id) return `${record.target_id}:${String(record.file_hash).slice(0, 16)}`;
  if (record.file_hash) return `sha256:${String(record.file_hash).slice(0, 16)}`;
  return null;
}

function buildSourceLookup(sources) {
  const lookup = new Map();
  for (const source of sources) {
    const id = sourceId(source);
    const key = sourceDocumentKey(source);
    if (key) lookup.set(`key:${key}`, { source, id });
    if (source.source_url) lookup.set(`url:${source.source_url}`, { source, id });
    if (source.storage_path) lookup.set(`path:${source.storage_path}`, { source, id });
  }
  return lookup;
}

function loadReviewFiles(reviewsDir) {
  let names;
  try {
    names = readdirSync(reviewsDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(reviewsDir, name));
}

function normalizeConcept(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchConcept(label) {
  const normalized = normalizeConcept(label);
  if (!normalized) return null;
  for (const [conceptId, nodeId, aliases] of CONCEPTS) {
    if (aliases.some((alias) => normalizeConcept(alias) === normalized)) {
      return { known: true, conceptId, nodeId, displayName: aliases[0] };
    }
  }
  return {
    known: false,
    conceptId: `con_agent_${hash(normalized, 16)}`,
    nodeId: `node_con_agent_${hash(normalized, 16)}`,
    displayName: String(label).trim(),
  };
}

function normalizeAnswerFormat(value) {
  const normalized = String(value ?? "mixed").trim();
  if (VALID_ANSWER_FORMATS.has(normalized)) return normalized;
  if (normalized === "short_answer") return "short_text";
  if (normalized === "written_derivation") return "derivation";
  return "mixed";
}

function normalizeDifficulty(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= 5) return number;
  const text = String(value ?? "").toLowerCase();
  if (text === "easy") return 2;
  if (text === "medium") return 3;
  if (text === "hard") return 4;
  return 3;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function assertValidReviewProblem(filePath, document, problem, index) {
  const location = `${path.relative(ROOT, filePath)} document=${document.source_document_key || document.source_url} problem=${index + 1}`;
  if (!problem || typeof problem !== "object") throw new Error(`${location}: problem must be an object`);
  if (!problem.problem_title || typeof problem.problem_title !== "string") throw new Error(`${location}: problem_title is required`);
  if (!Array.isArray(problem.page_ranges) || problem.page_ranges.length === 0) throw new Error(`${location}: page_ranges must be a non-empty array`);
  for (const [rangeIndex, range] of problem.page_ranges.entries()) {
    const start = Number(range?.start_page);
    const end = Number(range?.end_page);
    if (!Number.isInteger(start) || start < 1) throw new Error(`${location}: page_ranges[${rangeIndex}].start_page must be a positive integer`);
    if (!Number.isInteger(end) || end < start) throw new Error(`${location}: page_ranges[${rangeIndex}].end_page must be an integer >= start_page`);
  }
  if (!Array.isArray(problem.concepts) || problem.concepts.length === 0) throw new Error(`${location}: concepts must be a non-empty array`);
  const difficulty = Number(problem.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${location}: difficulty must be an integer from 1 to 5`);
  const confidence = Number(problem.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`${location}: confidence must be a number from 0 to 1`);
  normalizeAnswerFormat(problem.answer_format);
}

function pageBounds(problem) {
  const ranges = Array.isArray(problem.page_ranges) ? problem.page_ranges : [];
  const starts = ranges.map((range) => Number(range.start_page)).filter(Number.isFinite);
  const ends = ranges.map((range) => Number(range.end_page)).filter(Number.isFinite);
  return {
    pageStart: starts.length ? Math.min(...starts) : null,
    pageEnd: ends.length ? Math.max(...ends) : null,
    pageLabel: ranges
      .map((range) => `${range.start_page ?? "?"}-${range.end_page ?? range.start_page ?? "?"}`)
      .join(", "),
  };
}

function problemId(review, document, problem, index) {
  const base = problem.problem_id || `${review.batch_id}:${document.source_document_key || document.source_url}:problem-${index + 1}`;
  return `prob_rev_${hash(base, 18)}`;
}

function nodeId(entityType, entityId) {
  return `node_${hash(`${entityType}:${entityId}`, 20)}`;
}

function edgeId(problemNodeId, edgeType, conceptNodeId) {
  return `edge_${hash(`${problemNodeId}:${edgeType}:${conceptNodeId}`, 24)}`;
}

function conceptSlug(displayName, conceptId) {
  return `agent.${hash(`${displayName}:${conceptId}`, 20)}`;
}

function findSource(lookup, document) {
  const candidates = [
    document.source_document_key ? `key:${document.source_document_key}` : null,
    document.source_url ? `url:${document.source_url}` : null,
    document.storage_path ? `path:${document.storage_path}` : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const found = lookup.get(candidate);
    if (found) return found;
  }
  return null;
}

function collectReviews(reviewFiles, sourceLookup) {
  const importedProblems = [];
  const unknownConcepts = new Map();
  const warnings = [];

  for (const filePath of reviewFiles) {
    const review = readJson(filePath);
    for (const document of review.documents ?? []) {
      const foundSource = findSource(sourceLookup, document);
      if (!foundSource) {
        warnings.push(
          `${path.relative(ROOT, filePath)}: skipped stale document review because source document was not found: ${
            document.source_document_key || document.source_url || document.storage_path
          }`,
        );
        continue;
      }
      const { source, id: sourceDocumentId } = foundSource;
      for (const [index, problem] of (document.problems ?? []).entries()) {
        assertValidReviewProblem(filePath, document, problem, index);
        const conceptMap = new Map();
        for (const rawConcept of [...new Set((problem.concepts ?? []).map(String).map((value) => value.trim()).filter(Boolean))]) {
          const concept = matchConcept(rawConcept);
          if (concept) conceptMap.set(concept.conceptId, concept);
        }
        const concepts = [...conceptMap.values()];
        const knownConcepts = concepts.filter((concept) => concept.known);
        for (const concept of concepts.filter((item) => !item.known)) unknownConcepts.set(concept.conceptId, concept);

        const confidence = normalizeConfidence(problem.confidence);
        const status = knownConcepts.length > 0 && confidence >= 0.7 ? "reviewed" : "candidate";
        if (status !== "reviewed") {
          warnings.push(`${filePath}: ${problem.problem_id || problem.problem_title} imported as candidate because approved known concept or confidence is missing`);
        }

        const { pageStart, pageEnd, pageLabel } = pageBounds(problem);
        const pid = problemId(review, document, problem, index);
        importedProblems.push({
          id: pid,
          sourceDocumentId,
          source,
          label: String(problem.problem_title || `Problem ${index + 1}`).slice(0, 120),
          pageStart,
          pageEnd,
          statementText: [
            String(problem.problem_title || `Problem ${index + 1}`),
            `${source.university} ${source.graduate_school ?? ""} ${source.exam_year}年度 ${document.subject ?? source.exam_category ?? ""}`.trim(),
            pageLabel ? `Pages: ${pageLabel}` : null,
            concepts.length ? `Concepts: ${concepts.map((concept) => concept.displayName).join(", ")}` : null,
            problem.notes ? `Review note: ${problem.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          subjectRaw: document.subject || source.default_subject || source.exam_category || null,
          difficulty: normalizeDifficulty(problem.difficulty),
          estimatedMinutes: Math.min(180, Math.max(10, normalizeDifficulty(problem.difficulty) * 12)),
          answerFormat: normalizeAnswerFormat(problem.answer_format),
          status,
          confidence,
          concepts,
          reviewFile: path.relative(ROOT, filePath),
        });
      }
    }
  }

  return { importedProblems, unknownConcepts: [...unknownConcepts.values()], warnings };
}

function buildSql({ importedProblems, unknownConcepts }) {
  const problemIds = importedProblems.map((problem) => problem.id);
  const quotedProblemIds = problemIds.map(sqlString).join(", ");
  const lines = [
    "-- Generated by scripts/import-agent-reviews.mjs",
    "INSERT OR IGNORE INTO users (id, display_name, email, role, status) VALUES ('usr_agent_reviewer', 'Agent PDF reviewer', 'agent-reviewer@internal.local', 'reviewer', 'active');",
    "DELETE FROM recommendation_candidates;",
  ];

  for (const [conceptId, conceptNodeId, aliases] of CONCEPTS) {
    const name = aliases[0];
    lines.push(
      `INSERT OR IGNORE INTO concepts (id, slug, name_ja, name_en, aliases, concept_type, description, created_by, reviewed_by) VALUES (` +
        [
          sqlString(conceptId),
          sqlString(`catalog.${hash(conceptId, 16)}`),
          sqlString(name),
          sqlString(/[a-z]/i.test(name) ? name : null),
          sqlString(JSON.stringify(aliases)),
          sqlString("concept"),
          sqlString("Seeded or importer-known Concept for reviewed graduate exam metadata."),
          sqlString("usr_agent_reviewer"),
          sqlString("usr_agent_reviewer"),
        ].join(", ") +
        `);`,
    );
    lines.push(
      `INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name) VALUES (` +
        [sqlString(conceptNodeId), sqlString("concept"), sqlString(conceptId), sqlString(name)].join(", ") +
        `);`,
    );
  }

  if (problemIds.length) {
    lines.push(`DELETE FROM problem_search_fts WHERE problem_id IN (${quotedProblemIds});`);
    lines.push(`DELETE FROM knowledge_edges WHERE from_node_id IN (SELECT node_id FROM node_registry WHERE entity_type = 'problem' AND entity_id IN (${quotedProblemIds}));`);
    lines.push(`DELETE FROM node_registry WHERE entity_type = 'problem' AND entity_id IN (${quotedProblemIds});`);
    lines.push(`DELETE FROM problems WHERE id IN (${quotedProblemIds}) AND created_by = 'usr_agent_reviewer';`);
  }

  for (const concept of unknownConcepts) {
    lines.push(
      `INSERT OR IGNORE INTO concepts (id, slug, name_ja, aliases, concept_type, description, created_by, reviewed_by) VALUES (` +
        [
          sqlString(concept.conceptId),
          sqlString(conceptSlug(concept.displayName, concept.conceptId)),
          sqlString(concept.displayName),
          sqlString(JSON.stringify([concept.displayName])),
          sqlString("concept"),
          sqlString("Agent review imported concept candidate. Edges stay candidate until reviewed."),
          sqlString("usr_agent_reviewer"),
          "NULL",
        ].join(", ") +
        `);`,
    );
    lines.push(
      `INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name) VALUES (` +
        [sqlString(concept.nodeId), sqlString("concept"), sqlString(concept.conceptId), sqlString(concept.displayName)].join(", ") +
        `);`,
    );
  }

  for (const problem of importedProblems) {
    const problemNodeId = nodeId("problem", problem.id);
    lines.push(
      `INSERT OR REPLACE INTO problems (` +
        `id, source_document_id, problem_label, page_start, page_end, statement_text, subject_raw, difficulty, estimated_minutes, answer_format, status, embedding_status, created_by, reviewed_by` +
        `) VALUES (` +
        [
          sqlString(problem.id),
          sqlString(problem.sourceDocumentId),
          sqlString(problem.label),
          problem.pageStart ?? "NULL",
          problem.pageEnd ?? "NULL",
          sqlString(problem.statementText),
          sqlString(problem.subjectRaw),
          problem.difficulty,
          problem.estimatedMinutes,
          sqlString(problem.answerFormat),
          sqlString(problem.status),
          sqlString("stale"),
          sqlString("usr_agent_reviewer"),
          problem.status === "reviewed" ? sqlString("usr_agent_reviewer") : "NULL",
        ].join(", ") +
        `);`,
    );
    lines.push(
      `INSERT OR REPLACE INTO node_registry (node_id, entity_type, entity_id, display_name) VALUES (` +
        [sqlString(problemNodeId), sqlString("problem"), sqlString(problem.id), sqlString(`${problem.source.university} ${problem.source.exam_year} ${problem.label}`)].join(", ") +
        `);`,
    );
    lines.push(
      `INSERT OR REPLACE INTO problem_search_fts (problem_id, statement_text, explanation_text) VALUES (` +
        [sqlString(problem.id), sqlString(problem.statementText), "NULL"].join(", ") +
        `);`,
    );

    for (const concept of problem.concepts) {
      const edgeStatus = problem.status === "reviewed" && concept.known ? "approved" : "candidate";
      lines.push(
        `INSERT OR REPLACE INTO knowledge_edges (id, from_node_id, edge_type, to_node_id, weight, confidence, evidence_type, status, created_by, reviewed_by) VALUES (` +
          [
            sqlString(edgeId(problemNodeId, "tests", concept.nodeId)),
            sqlString(problemNodeId),
            sqlString("tests"),
            sqlString(concept.nodeId),
            "0.90",
            problem.confidence.toFixed(2),
            sqlString("manual"),
            sqlString(edgeStatus),
            sqlString("usr_agent_reviewer"),
            edgeStatus === "approved" ? sqlString("usr_agent_reviewer") : "NULL",
          ].join(", ") +
          `);`,
      );
    }
  }

  for (const sourceDocumentId of [...new Set(importedProblems.map((problem) => problem.sourceDocumentId))]) {
    const hasCandidate = importedProblems.some((problem) => problem.sourceDocumentId === sourceDocumentId && problem.status !== "reviewed");
    lines.push(
      `UPDATE source_documents SET extraction_status = ${sqlString(hasCandidate ? "problem_split" : "reviewed")} WHERE id = ${sqlString(sourceDocumentId)};`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function applySql(sqlPath, mode) {
  const args = ["wrangler", "d1", "execute", "graduate_exam_db", mode === "remote" ? "--remote" : "--local", `--file=${sqlPath}`];
  if (process.env.WRANGLER_CONFIG) args.push("--config", process.env.WRANGLER_CONFIG);
  if (process.env.WRANGLER_ENV) args.push("--env", process.env.WRANGLER_ENV);
  const result = spawnSync("npx", args, { cwd: ROOT, stdio: "inherit", shell: false });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const reviewFiles = loadReviewFiles(options.reviewsDir);
  const sources = readJson(options.sourcesPath);
  const sourceLookup = buildSourceLookup(sources);
  const result = collectReviews(reviewFiles, sourceLookup);

  const summary = {
    review_files: reviewFiles.length,
    imported_problems: result.importedProblems.length,
    reviewed_problems: result.importedProblems.filter((problem) => problem.status === "reviewed").length,
    candidate_problems: result.importedProblems.filter((problem) => problem.status !== "reviewed").length,
    unknown_concepts: result.unknownConcepts.length,
    warnings: result.warnings,
  };

  if (options.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  writeFileSync(options.sqlPath, buildSql(result));
  console.log(JSON.stringify({ ...summary, sql: path.relative(ROOT, options.sqlPath) }, null, 2));
  if (options.apply) applySql(options.sqlPath, options.apply);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
