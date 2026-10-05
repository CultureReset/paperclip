import type { RequestHandler } from "express";
import { forbidden } from "../errors.js";

/**
 * The reads a NEXT GENT device token may make (DECISIONS #71): the company's
 * devices, store listing, approvals and activity. The token is an agent API
 * key on the company's assistant with scope `{ kind: "device" }`; everything
 * else it tries is refused here, before any route runs, so there is one
 * place that says what a box can do.
 */
export const DEVICE_TOKEN_READ_PATHS = ["devices", "store", "approvals", "activity"] as const;

const companyRead = new RegExp(`^/api/companies/([^/]+)/(${DEVICE_TOKEN_READ_PATHS.join("|")})/?$`);

export function nextgentDeviceTokenGuard(): RequestHandler {
  return (req, _res, next) => {
    if (req.actor.type !== "agent" || req.actor.keyScope?.kind !== "device") {
      next();
      return;
    }
    const method = req.method.toUpperCase();
    const match = method === "GET" || method === "HEAD" ? companyRead.exec(req.path) : null;
    if (!match || match[1] !== req.actor.companyId) {
      next(forbidden("A device token can only read its company's devices, store, approvals and activity"));
      return;
    }
    next();
  };
}
