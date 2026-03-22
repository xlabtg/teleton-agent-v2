import { describe, it, expect } from "vitest";
import { TimeParser } from "../../packages/intelligence/src/time-parser.js";

const REF = new Date("2024-06-15T12:00:00Z"); // Saturday

function parser() {
  return new TimeParser({ referenceDate: REF });
}

describe("TimeParser", () => {
  describe("relative: 'in N unit'", () => {
    it("should resolve 'in 2 hours'", () => {
      const result = parser().parse("in 2 hours");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getTime()).toBeCloseTo(REF.getTime() + 2 * 3_600_000, -2);
        expect(result.offsetMs).toBe(2 * 3_600_000);
      }
    });

    it("should resolve 'in 30 minutes'", () => {
      const result = parser().parse("in 30 minutes");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getTime()).toBeCloseTo(REF.getTime() + 30 * 60_000, -2);
      }
    });

    it("should resolve 'in 1 week'", () => {
      const result = parser().parse("in 1 week");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getTime()).toBeCloseTo(REF.getTime() + 7 * 86_400_000, -2);
      }
    });
  });

  describe("relative: 'N unit ago'", () => {
    it("should resolve '3 days ago'", () => {
      const result = parser().parse("3 days ago");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.offsetMs).toBe(-(3 * 86_400_000));
      }
    });
  });

  describe("named relative terms", () => {
    it("should resolve 'today'", () => {
      const result = parser().parse("today");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.toISOString().startsWith("2024-06-15")).toBe(true);
      }
    });

    it("should resolve 'tomorrow'", () => {
      const result = parser().parse("tomorrow");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.toISOString().startsWith("2024-06-16")).toBe(true);
      }
    });

    it("should resolve 'yesterday'", () => {
      const result = parser().parse("yesterday");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.toISOString().startsWith("2024-06-14")).toBe(true);
      }
    });

    it("should resolve 'next week'", () => {
      const result = parser().parse("next week");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getTime()).toBeGreaterThan(REF.getTime());
      }
    });
  });

  describe("weekday references", () => {
    it("should resolve 'next monday'", () => {
      // REF is Saturday (day 6). Next monday = +2 days.
      const result = parser().parse("next monday");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getUTCDay()).toBe(1); // Monday
        expect(result.date.getTime()).toBeGreaterThan(REF.getTime());
      }
    });

    it("should resolve 'last friday'", () => {
      // REF is Saturday (day 6). Last friday = -1 day.
      const result = parser().parse("last friday");
      expect(result.kind).toBe("relative");
      if (result.kind === "relative") {
        expect(result.date.getUTCDay()).toBe(5); // Friday
        expect(result.date.getTime()).toBeLessThan(REF.getTime());
      }
    });
  });

  describe("absolute ISO dates", () => {
    it("should parse '2024-12-25'", () => {
      const result = parser().parse("2024-12-25");
      expect(result.kind).toBe("absolute");
      if (result.kind === "absolute") {
        expect(result.date.getUTCFullYear()).toBe(2024);
        expect(result.date.getUTCMonth()).toBe(11); // December
        expect(result.date.getUTCDate()).toBe(25);
      }
    });
  });

  describe("month-name dates", () => {
    it("should parse 'March 15, 2024'", () => {
      const result = parser().parse("March 15, 2024");
      expect(result.kind).toBe("absolute");
      if (result.kind === "absolute") {
        expect(result.date.getUTCMonth()).toBe(2); // March
        expect(result.date.getUTCDate()).toBe(15);
        expect(result.date.getUTCFullYear()).toBe(2024);
      }
    });

    it("should default to current year when no year given", () => {
      const result = parser().parse("December 1st");
      expect(result.kind).toBe("absolute");
      if (result.kind === "absolute") {
        expect(result.date.getUTCFullYear()).toBe(2024);
      }
    });
  });

  describe("time of day attachment", () => {
    it("should set time when 'at 9am' is present", () => {
      const result = parser().parse("tomorrow at 9am");
      if (result.kind === "relative") {
        expect(result.date.getUTCHours()).toBe(9);
      }
    });

    it("should convert pm correctly", () => {
      const result = parser().parse("tomorrow at 3pm");
      if (result.kind === "relative") {
        expect(result.date.getUTCHours()).toBe(15);
      }
    });
  });

  describe("extractAll", () => {
    it("should extract multiple expressions from text", () => {
      const p = parser();
      const extractions = p.extractAll("Send a message tomorrow and follow up in 3 days");
      const kinds = extractions.map((e) => e.parsed.kind);
      expect(kinds.some((k) => k === "relative")).toBe(true);
    });

    it("should return empty array for text with no time expressions", () => {
      const p = parser();
      expect(p.extractAll("Hello world")).toHaveLength(0);
    });
  });

  describe("unrecognized", () => {
    it("should return unrecognized for nonsense input", () => {
      const result = parser().parse("no time expression here");
      expect(result.kind).toBe("unrecognized");
    });
  });
});
