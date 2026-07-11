import { describe, expect, it } from "vitest";
import { strokeIntersectsPoint, type Stroke } from "../src/app/drawing";

const stroke: Stroke = {
  tool: "pen",
  width: 4,
  points: [
    { x: 0.1, y: 0.2, pressure: 0.5 },
    { x: 0.9, y: 0.2, pressure: 0.5 },
  ],
};

describe("strokeIntersectsPoint", () => {
  it("detects a point close to a stroke segment", () => {
    expect(strokeIntersectsPoint(stroke, { x: 0.5, y: 0.21, pressure: 0.5 }, 1000, 1000, 14)).toBe(true);
  });

  it("keeps strokes outside the object eraser radius", () => {
    expect(strokeIntersectsPoint(stroke, { x: 0.5, y: 0.4, pressure: 0.5 }, 1000, 1000, 14)).toBe(false);
  });

  it("does not target pixel eraser history", () => {
    expect(strokeIntersectsPoint({ ...stroke, tool: "eraser" }, { x: 0.5, y: 0.2, pressure: 0.5 }, 1000, 1000, 14)).toBe(false);
  });
});
