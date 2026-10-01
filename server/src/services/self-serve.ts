import { isCloudManagedInstance, type CloudInstanceEnv } from "./cloud-instance.js";

/**
 * Self-serve workspaces: any signed-in person may create an organization and
 * becomes its owner, so a new sign-up lands on its own empty dashboard
 * instead of "No organization access".
 *
 * Off unless PAPERCLIP_SELF_SERVE_COMPANIES=true, and never on a Paperclip
 * Cloud-managed instance, which provisions companies itself.
 */
export function isSelfServeCompanyCreationEnabled(env: CloudInstanceEnv = process.env): boolean {
  return env.PAPERCLIP_SELF_SERVE_COMPANIES?.trim().toLowerCase() === "true" && !isCloudManagedInstance(env);
}
