/**
 * Provider-agnostic types for the AI analysis seam (docs/DESIGN.md §10).
 *
 * The orchestrator builds ONE AnalysisInput per run and hands the identical
 * input to every configured provider, so a model swap or addition never touches
 * the calling code — only the provider list changes.
 */
import type { AiFinding } from "@/db/schema/ai";

export type { AiFinding };

export type AnalysisScopeType = "district" | "school";

export interface AnalysisScope {
  type: AnalysisScopeType;
  /** schools.id or districts.id depending on `type`. */
  id: number;
  /** Always the district id (the school's district for school scope). */
  districtId: number;
  /** Human label for the prompt + UI, e.g. "Redlands USD — North IDF". */
  label: string;
}

export interface AnalysisWindow {
  start: Date;
  end: Date;
}

/**
 * Fully-assembled, provider-agnostic call input. `instructions` is the analyst
 * brief (system prompt); `context` is the compiled evidence the model reads.
 * Both are plain strings so every adapter ships them however its API expects.
 */
export interface AnalysisInput {
  scope: AnalysisScope;
  window: AnalysisWindow;
  instructions: string;
  context: string;
}

/** What every provider returns. Stored as one ai_analyses row. */
export interface AiAnalysisResult {
  providerId: string;
  model: string;
  prose: string;
  findings: AiFinding[];
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

/**
 * Resolved, connect-ready config for one provider (secrets decrypted). Built by
 * src/lib/ai/settings.ts from the DB row, with env vars as a fallback.
 */
export interface ResolvedProviderConfig {
  providerId: string;
  /** Admin toggle — a configured-but-disabled provider is skipped. */
  enabled: boolean;
  apiKey?: string;
  /** Deployment name (Azure) or model id (OpenAI / Anthropic). */
  model?: string;
  endpoint?: string; // Azure OpenAI endpoint
  apiVersion?: string; // Azure OpenAI
  organization?: string; // OpenAI org id
  project?: string; // OpenAI project id
  baseURL?: string; // OpenAI base URL override (optional)
}

/** Per-call knobs resolved from the global ai_settings row. */
export interface AnalyzeOptions {
  maxOutputTokens: number;
}

/** Static metadata describing what config fields a provider needs (for the UI). */
export interface ProviderFieldSpec {
  /** Label + placeholder for the model/deployment input. */
  modelLabel: string;
  modelPlaceholder: string;
  /** Azure: endpoint + api version. */
  needsEndpoint: boolean;
  needsApiVersion: boolean;
  /** OpenAI: optional org + project. */
  needsOrgProject: boolean;
}

export interface AiProvider {
  /** Stable id, stored in ai_analyses.provider_id. */
  id: string;
  /** Display name for the comparison column header + settings card. */
  label: string;
  /** What the settings form should render for this provider. */
  fields: ProviderFieldSpec;
  /** Usable with this resolved config? (Key + required fields present.) The
   *  `enabled` toggle is enforced separately by the orchestrator. */
  isConfigured(cfg: ResolvedProviderConfig): boolean;
  analyze(
    input: AnalysisInput,
    cfg: ResolvedProviderConfig,
    opts: AnalyzeOptions,
  ): Promise<AiAnalysisResult>;
  /**
   * Generic single completion (system + user → text). Used by non-analysis AI
   * features such as device-type adjudication, where the caller parses the text
   * itself. `json` requests strict JSON output where the provider supports it.
   */
  complete(
    msg: { system: string; user: string },
    cfg: ResolvedProviderConfig,
    opts: { maxOutputTokens: number; json?: boolean },
  ): Promise<CompletionResult>;
}

/** What every provider's `complete()` returns. */
export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}
