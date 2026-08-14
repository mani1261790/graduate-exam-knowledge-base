import { describe, expect, it } from "vitest";
import { listProblems, searchQueryVariants } from "../src/worker/repository";

describe("searchQueryVariants", () => {
  it("keeps exact technical keywords intact", () => {
    expect(searchQueryVariants("二分木")).toEqual(["二分木"]);
  });

  it("extracts useful words from a casual Japanese query", () => {
    expect(searchQueryVariants("木の証明っぽいやつ")).toEqual(["木の証明っぽいやつ", "木", "証明"]);
  });

  it("searches labels and linked concepts with casual query keywords", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database;

    await listProblems(db, { id: "user_1", role: "member" } as never, { q: "木の証明っぽいやつ" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("p.problem_label LIKE ?");
    expect(calls[0]?.sql).toContain("search_concept.name_ja LIKE ?");
    expect(calls[0]?.values).toContain("%木%");
    expect(calls[0]?.values).toContain("%証明%");
  });
});
