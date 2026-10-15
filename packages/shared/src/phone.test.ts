import { describe, expect, it } from "vitest";
import { maskPhone, normalizeNigerianPhone } from "./phone.js";

describe("normalizeNigerianPhone", () => {
  it.each([
    ["08012345678", "+2348012345678"],
    ["2348012345678", "+2348012345678"],
    ["+2348012345678", "+2348012345678"],
    ["+234 801 234 5678", "+2348012345678"],
    ["0901-234-5678", "+2349012345678"],
    ["07031234567", "+2347031234567"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0801234567", "080123456789", "+14155550123", "06012345678", "abc08012345678"])(
    "rejects %s",
    (input) => {
      expect(normalizeNigerianPhone(input)).toBeNull();
    },
  );
});

describe("maskPhone", () => {
  it("hides the middle digits", () => {
    expect(maskPhone("+2348012345678")).toBe("+234 801 *** 5678");
  });
});
