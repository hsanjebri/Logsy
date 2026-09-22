import { EnvValidationError, llmEnvSchema, loadEnv } from '@logsy/config';
import {
  analyzeLog,
  createConfiguredProvider,
  summarizeLogAnalysis,
  type LlmProvider,
  type LogAnalysisSummary,
} from '@logsy/llm';

export interface ModelStatus {
  /** What the window shows in the toolbar. */
  label: string;
  ready: boolean;
  detail: string;
}

export interface AnalyzeRequest {
  log: string;
  name: string;
  skipRules: boolean;
  useLlm: boolean;
}

export type AnalyzeResponse =
  { ok: true; result: LogAnalysisSummary } | { ok: false; message: string };

let cached: { provider?: LlmProvider; status: ModelStatus } | undefined;

/**
 * Reads the LLM settings once, from the same .env the rest of Logsy uses. A missing
 * key is not fatal: rules, redaction and the comment work without a model.
 */
export function models(): { provider?: LlmProvider; status: ModelStatus } {
  if (cached) return cached;
  try {
    const env = loadEnv([llmEnvSchema]);
    const provider = createConfiguredProvider({
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      modelFast: env.LLM_MODEL_FAST,
      panel: env.LLM_PANEL,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      groqApiKey: env.GROQ_API_KEY,
      geminiApiKey: env.GEMINI_API_KEY,
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
    });
    cached = {
      provider,
      status: {
        ready: true,
        label: env.LLM_PANEL ? `Panel of ${String(env.LLM_PANEL.length)}` : provider.model,
        detail: provider.model,
      },
    };
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    cached = {
      provider: undefined,
      status: {
        ready: false,
        label: 'Rules only',
        detail: `No model configured (${error.issues.map((issue) => issue.variable).join(', ')}). Set one in .env to explain failures no rule covers.`,
      },
    };
  }
  return cached;
}

export async function analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  if (request.log.trim() === '') return { ok: false, message: 'That file is empty.' };

  const { provider } = models();
  if (request.skipRules && !provider) {
    return { ok: false, message: 'Skipping the rules needs a model configured in .env.' };
  }

  try {
    const result = await analyzeLog(request.log, {
      ...(request.useLlm ? { llm: provider } : {}),
      skipRules: request.skipRules,
      repoFullName: 'your-org/your-repo',
      jobName: request.name,
    });
    return { ok: true, result: summarizeLogAnalysis(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `The models could not be reached: ${message.slice(0, 300)}` };
  }
}
