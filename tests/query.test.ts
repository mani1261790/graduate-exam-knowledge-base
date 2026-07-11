import { describe, expect, it } from "vitest";
import { boundedIntegerParam } from "../src/worker/query";

describe("query parameters", () => {
  it("uses the default for missing, invalid, or fractional integer parameters", () => {
    const options = { defaultValue: 20, min: 1, max: 100 };

    expect(boundedIntegerParam(undefined, options)).toBe(20);
    expect(boundedIntegerParam("abc", options)).toBe(20);
    expect(boundedIntegerParam("1.5", options)).toBe(20);
  });

  it("clamps integer parameters to the configured bounds", () => {
    const options = { defaultValue: 20, min: 1, max: 100 };

    expect(boundedIntegerParam("-10", options)).toBe(1);
    expect(boundedIntegerParam("3", options)).toBe(3);
    expect(boundedIntegerParam("500", options)).toBe(100);
  });
});
