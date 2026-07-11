import { describe, expect, it } from "vitest";
import { fmtPrice, fmtUsdc, truncateMiddle } from "./format.js";

describe("dashboard format helpers", () => {
  it("formats USDC base units", () => {
    expect(fmtUsdc("10300")).toBe("$0.0103");
    expect(fmtUsdc("5000000")).toBe("$5.00");
    expect(fmtUsdc(null)).toBe("$0.00");
  });

  it("formats verdict truth as a price, passes hashes through", () => {
    expect(fmtPrice("50100")).toBe("$50,100.00");
    expect(fmtPrice("0xabc")).toBe("0xabc");
    expect(fmtPrice(null)).toBe("—");
  });

  it("truncates long identifiers", () => {
    expect(truncateMiddle("abcdef0000000uvwxyz", 4)).toBe("abcd…wxyz");
    expect(truncateMiddle("short")).toBe("short");
  });
});
