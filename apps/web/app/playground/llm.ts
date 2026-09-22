import { EnvValidationError, llmEnvSchema, loadEnv } from '@logsy/config';
import { createConfiguredProvider, type LlmProvider } from '@logsy/llm';

export interface PlaygroundLlm {
  provider: LlmProvider | undefined;
  /** What the page tells the visitor about the model setup. */
  note: string;
}

/**
 * The playground is public, so it spends LLM quota only when the operator opts in
 * with PLAYGROUND_LLM=true. Rules, redaction and the comment work either way.
 */
export function playgroundLlm(): PlaygroundLlm {
  if (process.env.PLAYGROUND_LLM !== 'true') {
    return {
      provider: undefined,
      note: 'Set PLAYGROUND_LLM=true to let the playground use the LLM.',
    };
  }
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
    return { provider, note: provider.model };
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    return {
      provider: undefined,
      note: `The LLM is not configured (${error.issues.map((issue) => issue.variable).join(', ')}).`,
    };
  }
}
