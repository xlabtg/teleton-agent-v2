import { describe, it, expect } from "vitest";
import { InputValidator } from "../../packages/security/src/input-validator.js";
import { ValidationError } from "../../packages/core/src/errors/domain-errors.js";

describe("InputValidator", () => {
  it("passes clean input and returns a ValidatedInput", () => {
    const v = new InputValidator();
    const result = v.validate("Hello, world!");
    expect(result.value).toBe("Hello, world!");
    expect(result.provenanceId).toBeTruthy();
    expect(result.validatedAt).toBeTruthy();
  });

  it("throws ValidationError when input exceeds maxInputLength", () => {
    const v = new InputValidator({ maxInputLength: 5 });
    expect(() => v.validate("123456")).toThrow(ValidationError);
  });

  it("strips null bytes and control characters", () => {
    const v = new InputValidator();
    const result = v.validate("hello\x00\x01world");
    expect(result.value).toBe("helloworld");
    expect(result.annotations["controlCharsStripped"]).toBe(true);
  });

  it("preserves allowed whitespace characters (\\t \\n \\r)", () => {
    const v = new InputValidator();
    const result = v.validate("line1\nline2\ttab");
    expect(result.value).toBe("line1\nline2\ttab");
  });

  it("runs custom field validators and throws on failure", () => {
    const v = new InputValidator({
      fieldValidators: {
        email: (val) => {
          if (typeof val !== "string" || !val.includes("@")) return "must be valid email";
          return null;
        },
      },
    });
    expect(() => v.validate("not-an-email", "email")).toThrow(ValidationError);
    expect(() => v.validate("user@example.com", "email")).not.toThrow();
  });

  it("runSyntaxStage returns passed=false for oversized input without throwing", () => {
    const v = new InputValidator({ maxInputLength: 3 });
    const result = v.runSyntaxStage("toolong");
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("runSyntaxStage normalises unicode to NFC", () => {
    const v = new InputValidator();
    // \u00e9 (precomposed é) vs \u0065\u0301 (decomposed e + combining acute)
    const decomposed = "\u0065\u0301";
    const result = v.runSyntaxStage(decomposed);
    expect((result.annotations["sanitized"] as string)).toBe("\u00e9");
  });
});
