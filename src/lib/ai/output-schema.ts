/**
 * The single structured-output contract both providers must satisfy. Azure
 * OpenAI consumes it as a `json_schema` response format; Anthropic consumes it
 * as a forced tool's `input_schema`. Keeping ONE schema guarantees the two
 * model columns are directly comparable.
 *
 * Constraints chosen for OpenAI strict mode: every property is required and
 * additionalProperties is false.
 */
import type { AiFinding } from "@/db/schema/ai";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const CONFIDENCES = ["definite", "suggestive"] as const;

/** JSON Schema for the model's response. Plain object so both SDKs accept it. */
export const ANALYSIS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description:
        "Readable narrative report for a network technician: network identity, " +
        "what changed over the window, and the headline issues. Markdown allowed.",
    },
    findings: {
      type: "array",
      description:
        "Discrete issues, each backed by evidence from the bundle data. Empty array if nothing notable.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: [...SEVERITIES] },
          confidence: { type: "string", enum: [...CONFIDENCES] },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: {
            type: "string",
            description:
              "The specific data that supports this, citing the source: " +
              'e.g. "dns_resolver_health: resolver 10.0.0.1 mean_ms=480 vs 12 for 1.1.1.1".',
          },
          recommendation: {
            type: "string",
            description: "Concrete next check the technician should run.",
          },
        },
        required: [
          "severity",
          "confidence",
          "title",
          "detail",
          "evidence",
          "recommendation",
        ],
      },
    },
  },
  required: ["summary", "findings"],
} as const;

/** Shape the model is asked to return (before normalization). */
export interface RawAnalysisOutput {
  summary?: unknown;
  findings?: unknown;
}

const SEVERITY_SET = new Set<string>(SEVERITIES);
const CONFIDENCE_SET = new Set<string>(CONFIDENCES);

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Coerce one raw finding into a safe AiFinding, clamping enums to known values. */
function normalizeFinding(raw: unknown): AiFinding {
  const f = (raw ?? {}) as Record<string, unknown>;
  const severity = str(f.severity).toLowerCase();
  const confidence = str(f.confidence).toLowerCase();
  return {
    severity: SEVERITY_SET.has(severity) ? severity : "info",
    confidence: CONFIDENCE_SET.has(confidence) ? confidence : "suggestive",
    title: str(f.title) || "Untitled finding",
    detail: str(f.detail),
    evidence: str(f.evidence),
    recommendation: str(f.recommendation),
  };
}

/** Normalize whatever the model returned into { prose, findings }. Tolerant of a
 *  raw JSON string, a parsed object, or a slightly-off shape. */
export function normalizeOutput(raw: unknown): {
  prose: string;
  findings: AiFinding[];
} {
  let obj: RawAnalysisOutput;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as RawAnalysisOutput;
    } catch {
      // Model returned prose instead of JSON — keep it as the narrative.
      return { prose: raw, findings: [] };
    }
  } else {
    obj = (raw ?? {}) as RawAnalysisOutput;
  }

  const findings = Array.isArray(obj.findings)
    ? obj.findings.map(normalizeFinding)
    : [];
  return { prose: str(obj.summary), findings };
}
