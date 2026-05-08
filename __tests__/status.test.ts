import { describe, expect, test } from "vitest";
import { shouldJobFail } from "../src/status.js";

describe("shouldJobFail", () => {
  test("fails when failure_on_error is true and job is cancelled (status 30)", () => {
    expect(shouldJobFail(30, true)).toBe(true);
  });

  test("fails when failure_on_error is true and job errored (status 20)", () => {
    expect(shouldJobFail(20, true)).toBe(true);
  });

  test("does not fail when failure_on_error is true and job succeeded (status 10)", () => {
    expect(shouldJobFail(10, true)).toBe(false);
  });

  test("does not fail when failure_on_error is false regardless of status", () => {
    expect(shouldJobFail(30, false)).toBe(false);
    expect(shouldJobFail(20, false)).toBe(false);
    expect(shouldJobFail(10, false)).toBe(false);
  });

  test("does not fail when status is unknown (no response)", () => {
    expect(shouldJobFail(undefined, true)).toBe(false);
  });
});
