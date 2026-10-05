import { AUTOMATION_STEP_CATALOGUE, automationStepDescriptor, type AutomationStepDescriptor } from "@paperclipai/shared";
import type { StepModule } from "../types.js";
import { agent } from "./agent.js";
import { aiPrompt } from "./ai.prompt.js";
import { condition } from "./condition.js";
import { dataInsert } from "./data.insert.js";
import { dataQuery } from "./data.query.js";
import { dataUpdate } from "./data.update.js";
import { emailSend } from "./email.send.js";
import { httpRequest } from "./http.request.js";
import { log } from "./log.js";
import { message } from "./message.js";
import { notify } from "./notify.js";
import { script } from "./script.js";
import { smsSend } from "./sms.send.js";
import { transform } from "./transform.js";
import { wait } from "./wait.js";

/**
 * The step registry: one module per step type (DECISIONS #81), keyed by the
 * same `type` the shared catalogue describes. Adding a step type means a new
 * catalogue entry (how it is drawn and validated) and a module here (how it runs).
 */
const MODULES: StepModule[] = [
  dataQuery, dataInsert, dataUpdate,
  condition, transform, script,
  aiPrompt, httpRequest,
  smsSend, emailSend, wait, agent, message, notify, log,
];

const REGISTRY = new Map<string, StepModule>(MODULES.map((module) => [module.type, module]));

for (const type of Object.keys(AUTOMATION_STEP_CATALOGUE)) {
  if (!REGISTRY.has(type)) throw new Error(`Automation step "${type}" is in the catalogue but has no runner module`);
}

export function stepModule(type: unknown): StepModule | null {
  return typeof type === "string" ? REGISTRY.get(type) ?? null : null;
}

export function stepDescriptor(type: unknown): AutomationStepDescriptor | null {
  return automationStepDescriptor(type);
}

export const STEP_TYPES = [...REGISTRY.keys()];
