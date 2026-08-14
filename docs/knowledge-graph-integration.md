# KnowledgeGraph integration

The application uses `KTaisei/KnowledgeGraph` as an offline graph generator.
Python and Ollama are not part of the deployed Cloudflare Worker.

```bash
npm run knowledge-graph:fetch
cd tmp/knowledge-graph-upstream
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python src/collector/main.py "学習したい内容"
cd ../..
npm run knowledge-graph:import -- --input=tmp/knowledge-graph-upstream/output/knowledge_graph.json --subject=algorithms --status=draft --apply-local
```

To connect graph nodes to reviewed application concepts, pass an explicit JSON
mapping with `--concept-map=/private/path/concept-map.json`. Keys may be an
upstream node ID or its exact label, and values are concept ID arrays:

```json
{
  "N01": ["con_graph"],
  "グラフ探索": ["con_graph_search"]
}
```

Keep production mappings outside the public repository when they are derived
from private problem data. Review the draft and mappings before re-running the
import with `--status=active`.

The repository includes a reviewed, explicit 18-node algorithm/discrete-math
graph in `docs/knowledge-graphs/`. It is a curated input in the upstream JSON
schema, so it can be validated and imported by the same KnowledgeGraph path
without requiring an Ollama model on the deployed Worker:

```bash
npm run knowledge-graph:import -- \
  --input=docs/knowledge-graphs/algorithms-discrete-v1.json \
  --concept-map=docs/knowledge-graphs/algorithms-discrete-v1.concept-map.json \
  --subject=algorithms --status=draft --apply-local
```

The reviewed curated inputs currently cover every selectable subject group:

| Subject key | Graph input | Nodes |
| --- | --- | ---: |
| `math` | `math-foundations-v1.json` | 12 |
| `algorithms` | `algorithms-discrete-v1.json` | 18 |
| `systems` | `computer-systems-v1.json` | 10 |
| `signals` | `signals-control-communications-v1.json` | 11 |
| `aiData` | `ai-data-analysis-v1.json` | 10 |
| `science` | `science-v1.json` | 11 |
| `english` | `english-academic-reading-v1.json` | 4 |
| `humanities` | `humanities-social-v1.json` | 6 |

Each input has a companion `.concept-map.json` file. These mappings contain
only public Concept identifiers; an import must be validated against the target
D1 database before activation.

An active graph must now map every node explicitly. This prevents a plan from
silently adding an unmapped "concept study" session as though it were grounded
in reviewed exam material.

The importer pins and records the upstream commit, validates node and edge
references, merges `prerequisites` with explicit edges, rejects cycles, and
stores a versioned draft. Concept mappings are explicit and reviewed; labels
are never silently matched to production concepts.

Only an active graph is used for student plans. Activation archives the prior
active version for the same subject. Generated graphs remain auditable through
their payload hash, upstream revision, model name, warnings, and reviewer.

The deployed runtime only reads versioned graphs from D1. That boundary keeps
the first release deterministic and allows a later phase to add per-user graph
generation behind a reviewed job or Workflow without putting Ollama, Wikipedia
collection, or Google Trends calls on the request path. Until that phase is
implemented, users select from subjects with an active reviewed graph.

The current upstream main pipeline collects Google Trends values, but its final
`build_graph_with_llm()` path does not consume those values. This integration
therefore does not treat search popularity as educational difficulty.
