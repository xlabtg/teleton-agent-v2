/**
 * Injection detector — V2-13.
 * Detects prompt injection and other injection attacks using a two-stage pipeline:
 *   1. Pattern matching — fast regex-based scan for known injection signatures
 *   2. Heuristic classifier — lightweight scoring when pattern stage is inconclusive
 *
 * The classifier stage is designed to be replaceable with an LLM-backed classifier
 * by providing a custom `ClassifierFn` in the config.
 */

export type ClassifierFn = (input: string) => Promise<InjectionClassification>;

export interface InjectionClassification {
  /** 0.0 (safe) – 1.0 (definitely injection) */
  score: number;
  /** Reason or evidence behind the classification */
  reason: string;
}

export type InjectionAction = "allow" | "block" | "quarantine";

export interface InjectionDetectorConfig {
  /** Score threshold above which input is blocked. Default: 0.8 */
  blockThreshold?: number;
  /** Score threshold above which input is quarantined (held for review). Default: 0.5 */
  quarantineThreshold?: number;
  /** Optional custom classifier (e.g. LLM-backed). Replaces the built-in heuristic. */
  classifier?: ClassifierFn;
  /** Additional custom patterns to detect. Merged with the built-in set. */
  additionalPatterns?: RegExp[];
}

export interface DetectionResult {
  /** Whether injection was detected */
  detected: boolean;
  /** Recommended action */
  action: InjectionAction;
  /** Combined injection confidence score (0–1) */
  score: number;
  /** Human-readable explanation */
  reason: string;
  /** Names of matched patterns (if any) */
  matchedPatterns: string[];
}

interface NamedPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Known prompt injection / attack patterns.
 * Updated when new techniques are identified — keep this list minimal and precise
 * to reduce false-positive rate.
 */
const BUILTIN_PATTERNS: NamedPattern[] = [
  { name: "ignore_previous", pattern: /ignore\s+(all\s+)?previous\s+(instructions?|prompts?)/i },
  { name: "new_instructions", pattern: /\bnew\s+instructions?\s*:/i },
  { name: "system_override", pattern: /\bsystem\s*:\s*you\s+are\b/i },
  { name: "jailbreak_dan", pattern: /\bDAN\s+mode\b|\bdo\s+anything\s+now\b/i },
  { name: "role_override", pattern: /\bact\s+as\s+(if\s+you\s+are|a\s+)?[A-Z][a-z]+\s+without\s+(restrictions?|limits?)/i },
  { name: "base64_injection", pattern: /\bbase64\b.*\bdecode\b|\bdecode\b.*\bbase64\b/i },
  { name: "sql_injection", pattern: /('\s*(OR|AND)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?|--\s*$|;\s*DROP\s+TABLE)/i },
  { name: "command_injection", pattern: /[`$](\(|{)|\|{1,2}\s*(bash|sh|cmd|powershell)\b/i },
  { name: "path_traversal", pattern: /\.\.(\/|\\){1,2}/},
  { name: "exfiltration_prompt", pattern: /\bsend\s+(all|the)\s+(data|contents?|secrets?|passwords?)\s+(to|via)\b/i },
];

export class InjectionDetector {
  private readonly blockThreshold: number;
  private readonly quarantineThreshold: number;
  private readonly classifier: ClassifierFn | undefined;
  private readonly patterns: NamedPattern[];

  constructor(config: InjectionDetectorConfig = {}) {
    this.blockThreshold = config.blockThreshold ?? 0.8;
    this.quarantineThreshold = config.quarantineThreshold ?? 0.5;
    this.classifier = config.classifier;
    this.patterns = [
      ...BUILTIN_PATTERNS,
      ...(config.additionalPatterns ?? []).map((p, i) => ({ name: `custom_${i}`, pattern: p })),
    ];
  }

  /**
   * Analyse input for injection signals.
   * Returns a DetectionResult with the recommended action.
   */
  async detect(input: string): Promise<DetectionResult> {
    const matchedPatterns: string[] = [];

    for (const { name, pattern } of this.patterns) {
      if (pattern.test(input)) {
        matchedPatterns.push(name);
      }
    }

    // Pattern stage: any match gives a base score
    const patternScore = matchedPatterns.length > 0
      ? Math.min(0.5 + matchedPatterns.length * 0.15, 1.0)
      : 0;

    // Classifier stage: run only when needed (inconclusive or above quarantine threshold)
    let classifierScore = 0;
    let classifierReason = "";
    if (this.classifier && patternScore < this.blockThreshold) {
      const classification = await this.classifier(input);
      classifierScore = classification.score;
      classifierReason = classification.reason;
    }

    const score = Math.max(patternScore, classifierScore);
    const reason = matchedPatterns.length > 0
      ? `Matched injection patterns: ${matchedPatterns.join(", ")}`
      : classifierReason || "No injection signals detected";

    const action = this.classifyAction(score);

    return {
      detected: score >= this.quarantineThreshold,
      action,
      score,
      reason,
      matchedPatterns,
    };
  }

  private classifyAction(score: number): InjectionAction {
    if (score >= this.blockThreshold) return "block";
    if (score >= this.quarantineThreshold) return "quarantine";
    return "allow";
  }
}
