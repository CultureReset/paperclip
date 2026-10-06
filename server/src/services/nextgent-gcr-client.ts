import { HttpError } from "../errors.js";
import { gcrConfigured, readNextgentConfig, type NextgentConfig } from "./nextgent-config.js";
import { signNextgentRequest, splitRequestUrl } from "./nextgent-service-signing.js";

/**
 * Signed calls from Paperclip to gcr-api-clean (contract §4). Shapes are the
 * contract's, nothing more. Every request carries the §3 signature headers.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The kinds gcr-api-clean is told about: the NEXT GENT section's, or the item's for an app or a layout. */
export type NextgentInstallKind = "agent" | "app" | "automation" | "layout";

export interface GcrLinkRequest {
  companyId: string;
  entitySlug?: string;
  create?: { name: string; kind: string; phone?: string; address?: string; website?: string };
  /** Revoke the company's live business token and return a new one. */
  rotateToken?: boolean;
  /** The owner's contact, so gcr-api-clean can send owner notifications. */
  notify?: { email?: string; phone?: string };
}
export interface GcrLinkResponse {
  entitySlug: string;
  forwardingAddress: string | null;
  /** Returned once; null on a repeat call (then `businessTokenIssued: true`). */
  businessToken: string | null;
  businessTokenIssued?: boolean;
  created?: boolean;
  /** The business's kind, if gcr-api-clean includes it (not in contract §4). Passed through, never stored (DECISIONS #32). */
  kind?: string;
  entityType?: string;
}

export interface GcrInstallRequest {
  companyId: string;
  installId: string;
  itemKey: string;
  kind: NextgentInstallKind;
  version: string;
  permissions: string[];
  /** The executor, distinct from GCR's business-data/token projection. */
  executionOwner?: "gcr" | "paperclip";
  /** The optional ones among `permissions` (granted, could have been declined). Not in contract §4. */
  optionalPermissions?: string[];
  routine?: { webhookUrl: string; webhookSecret: string };
  /** An app's manifest (the release's `payload.app`), projected into the business (Step 3 contract §A). */
  app?: Record<string, unknown>;
  /** A layout's manifest (the release's `payload.layout`); a layout never sends `app` (DECISIONS #31). */
  layout?: Record<string, unknown>;
  /** Whether the install is switched on; a pushed install starts off until the owner turns it on. */
  enabled?: boolean;
}

/** `PATCH /api/nextgent/installs/:id`: the switch, a version move, the manifest that version carries (`app` or `layout`). */
export interface GcrInstallPatch {
  enabled?: boolean;
  version?: string;
  app?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/**
 * One business kind among the linked businesses (`GET /api/nextgent/business-kinds`):
 * gcr-api-clean joins `company_links` to `entity.entity_type`. Paperclip keeps no copy (DECISIONS #32).
 */
export interface GcrBusinessKind {
  key: string;
  count: number;
  companyIds: string[];
}

/** Keep the well-formed entries of gcr-api-clean's answer; anything else is dropped rather than guessed at. */
function businessKindsOf(answer: unknown): GcrBusinessKind[] {
  if (!Array.isArray(answer)) return [];
  const kinds: GcrBusinessKind[] = [];
  for (const entry of answer) {
    if (!entry || typeof entry !== "object") continue;
    const { key, count, companyIds } = entry as Record<string, unknown>;
    if (typeof key !== "string" || key.trim() === "") continue;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) continue;
    if (!Array.isArray(companyIds) || !companyIds.every((id) => typeof id === "string")) continue;
    kinds.push({ key, count, companyIds: companyIds as string[] });
  }
  return kinds;
}

/** `POST /api/nextgent/nodes/pair`: Paperclip approves a pairing code, gcr-api-clean enrols the relay node (DECISIONS #69). */
export interface GcrPairNodeRequest {
  companyId: string;
  code: string;
  name?: string;
  /** Who approved, e.g. `paperclip:<userId>`. */
  approvedBy: string;
  /** The device token Paperclip minted; the box receives it through `/pair/poll` (DECISIONS #71). */
  deviceToken?: string;
}

/** A relay node as gcr-api-clean reports it (`ghost_nodes`). */
export interface GcrNode {
  id: string;
  name?: string | null;
  version?: string | null;
  health?: unknown;
  last_seen_at?: string | null;
  revoked_at?: string | null;
}

export interface GcrPairNodeResponse {
  node: GcrNode;
  /** The Ghost MCP credential for the cloud assistant, returned once (DECISIONS #74). */
  ghostMcpToken?: string | null;
}

export interface GcrEntitlement {
  allowed: boolean;
  reason?: string;
  priceCents?: number;
  interval?: string;
}

/** gcr-api-clean is not configured on this server (dev): callers skip with a warning. */
export class GcrNotConfiguredError extends Error {
  constructor() {
    super("GCR_API_URL and NEXTGENT_SERVICE_SECRET must both be set to reach gcr-api-clean");
    this.name = "GcrNotConfiguredError";
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return `gcr-api-clean answered HTTP ${status}`;
}

export function gcrClient(options: { config?: NextgentConfig; fetch?: FetchLike } = {}) {
  const config = options.config ?? readNextgentConfig();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  async function call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    if (!gcrConfigured(config)) throw new GcrNotConfiguredError();
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const url = `${config.gcrApiUrl}${path}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...signNextgentRequest(config.serviceSecret, { method, ...splitRequestUrl(url), rawBody }),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: rawBody } : {}),
      });
    } catch (error) {
      throw new HttpError(502, `Could not reach gcr-api-clean: ${(error as Error).message}`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      // Pass client errors (unknown business, not claimed, not entitled) through
      // to the caller; anything else is an upstream failure.
      const status = response.status >= 400 && response.status < 500 ? response.status : 502;
      // gcr-api-clean's own fields (e.g. claimRequired, claimInstead, reason)
      // travel with the error so the app can act on them.
      const extras: Record<string, unknown> = {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (key !== "error" && key !== "message") extras[key] = value;
        }
      }
      throw new HttpError(status, errorMessage(parsed, response.status), { upstreamStatus: response.status, upstream: extras });
    }
    return (parsed ?? {}) as T;
  }

  return {
    configured: gcrConfigured(config),
    link: (input: GcrLinkRequest) => call<GcrLinkResponse>("POST", "/api/nextgent/link", input),
    unlink: (input: { companyId: string; export: boolean }) =>
      call<Record<string, unknown>>("POST", "/api/nextgent/unlink", input),
    install: (input: GcrInstallRequest) =>
      call<{ token?: string; charged?: boolean; priceCents?: number; interval?: string; updated?: boolean }>(
        "POST",
        "/api/nextgent/installs",
        input,
      ),
    /** Switch an install on or off, or move it to a version (with that version's manifest) without re-registering it. */
    patchInstall: (installId: string, patch: GcrInstallPatch) =>
      call<{ updated?: boolean; projected?: boolean }>("PATCH", `/api/nextgent/installs/${encodeURIComponent(installId)}`, patch),
    /** gcr-api-clean switches the projection off and keeps the app's data (DECISIONS #22). */
    uninstall: (installId: string) =>
      call<Record<string, unknown>>("DELETE", `/api/nextgent/installs/${encodeURIComponent(installId)}`),
    /**
     * A short-lived session token for one install (at most 300 s, minted by
     * gcr-api-clean), for the screen that draws an installed app. The
     * long-lived install token itself never leaves this server.
     */
    installSession: (installId: string, companyId: string) =>
      call<{ token?: string; expiresAt?: string }>("POST", `/api/nextgent/installs/${encodeURIComponent(installId)}/session`, { companyId }),
    /** A platform email from one of gcr-api-clean's templates (e.g. a team invite). */
    sendEmail: (input: { companyId?: string; to: string; template: string; data: Record<string, unknown> }) =>
      call<{ sent?: boolean }>("POST", "/api/nextgent/email", input),
    /** gcr-api-clean billing's price for an item, used by entitlement and install charges. */
    setItemPrice: (
      itemKey: string,
      price: { amountCents: number; currency: string; interval: string | null; model: string | null },
    ) => call<Record<string, unknown>>("PUT", `/api/nextgent/items/${encodeURIComponent(itemKey)}/price`, price),
    entitlement: (companyId: string, itemKey: string) =>
      call<GcrEntitlement>(
        "GET",
        `/api/nextgent/entitlement?${new URLSearchParams({ companyId, itemKey }).toString()}`,
      ),
    /** The kinds of the linked businesses, with the companies of each, for the store's "kind" audience. */
    businessKinds: async () => businessKindsOf(await call<unknown>("GET", "/api/nextgent/business-kinds")),
    /** Approve a pairing code for a company's relay node; gcr-api-clean enrols it and answers with the node and the assistant's Ghost MCP token. */
    pairNode: (input: GcrPairNodeRequest) => call<GcrPairNodeResponse>("POST", "/api/nextgent/nodes/pair", input),
    /** Revoke a relay node (its token stops working) on unlink. */
    revokeNode: (nodeId: string, companyId: string) =>
      call<Record<string, unknown>>("POST", `/api/nextgent/nodes/${encodeURIComponent(nodeId)}/revoke`, { companyId }),
    /** The company's relay nodes as gcr-api-clean sees them (live detail; the registry here is ownership and state). */
    nodes: async (companyId: string) => {
      const answer = await call<unknown>("GET", `/api/nextgent/nodes?${new URLSearchParams({ companyId }).toString()}`);
      const list = Array.isArray(answer) ? answer : (answer as { nodes?: unknown })?.nodes;
      return (Array.isArray(list) ? list : []).filter((n): n is GcrNode => Boolean(n) && typeof n === "object" && typeof (n as GcrNode).id === "string");
    },
  };
}

export type GcrClient = ReturnType<typeof gcrClient>;

/** gcr-api-clean's extra fields on a refused call, for the app to act on. */
export function upstreamDetails(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof HttpError)) return null;
  const details = error.details as { upstream?: unknown } | undefined;
  return details?.upstream && typeof details.upstream === "object" ? (details.upstream as Record<string, unknown>) : null;
}
