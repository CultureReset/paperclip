import type { StepModule } from "../types.js";

/** A note the business sees in this run's history — no text, no email. */
export const notify: StepModule = {
  type: "notify",
  async run({ config, ctx }) {
    const note = { title: String(config.title ?? ""), message: String(config.message ?? ""), level: String(config.level || "info") };
    ctx.output.notices.push(note);
    return note;
  },
};
