import type { StepModule } from "../types.js";

/** A prompt to the company's model gateway; the answer is kept as {{ steps.<id>.text }}. */
export const aiPrompt: StepModule = {
  type: "ai.prompt",
  async run({ config, dryRun, deps }) {
    const task = String(config.task || "automation");
    if (dryRun) return { dry_run: true, would_ask: { task, prompt: config.prompt } };
    const { text } = await deps.ai({
      task,
      prompt: String(config.prompt ?? ""),
      system: config.system ? String(config.system) : undefined,
      maxTokens: Number(config.max_tokens) || 400,
    });
    return { text };
  },
};
