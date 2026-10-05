## Review: Play-user `claude/agent-ecosystem-architecture-nzexu1`, `cb1d269..HEAD` (9 commits, last one eb9c76f is WIP)

I changed nothing in the repo or any database. The checks I ran: `oxlint` is clean, `npm run check` passes, and `vite build` (output sent to my scratchpad) passes locally.

**The biggest problems:**
- Automations run on gcr-api-clean's own engine, not as Paperclip routines (spec E12/F).
- The owner's app area is a fixed set of ten screens. It is not built from installed apps (spec F).
- Installed apps can never draw in the WIP code, because Paperclip's store list doesn't send what it needs.
- The WIP `file:` dependency will break a standalone deploy.
- The shared `Sheet` steals focus, so business info can't be typed into.
- Viewers get stuck in setup.
- The automation webhook address points at the wrong server.

Findings from the WIP commit are marked **[WIP]**.

### 1. Coverage
Every file was read fully except the lockfile.

| File | +/− | Read fully |
|---|---|---|
| .env.example | 37/10 | yes |
| README.md | 36/6 | yes |
| api/biz/[...path].js | 58/0 | yes |
| index.html | 1/1 | yes |
| package-lock.json | 17/0 | **skipped (lockfile)** |
| package.json [WIP dep] | 2/1 | yes |
| scripts/check-format.mjs | 50/0 | yes |
| src/App.jsx | 73/17 | yes |
| src/app/AppShell.jsx | 175/0 | yes |
| src/app/AskContext.jsx | 8/0 | yes |
| src/app/AskPanel.jsx | 56/0 | yes |
| src/app/Conversation.jsx | 107/0 | yes |
| src/app/nav.js | 17/0 | yes |
| src/app/useAssistant.js | 21/0 | yes |
| src/components/AddSection.jsx | 11/5 | yes |
| src/components/BottomNav.jsx (deleted) | 0/39 | yes |
| src/components/InstalledApp.jsx [WIP] | 36/0 | yes |
| src/components/MainContent.jsx (deleted) | 0/17 | yes |
| src/components/RowEditor.jsx | 26/24 | yes |
| src/components/TopBar.jsx (deleted) | 0/129 | yes |
| src/index.css | 24/0 | yes |
| src/lib/AuthContext.jsx | 6/3 | yes |
| src/lib/BusinessContext.jsx | 55/0 | yes |
| src/lib/apiClient.js | 9/235 | yes |
| src/lib/appStore.js | 5/5 | yes |
| src/lib/authStore.js (deleted) | 0/153 | yes (code; comment lines skimmed) |
| src/lib/biz.js | 165/0 | yes |
| src/lib/bizToken.js | 46/0 | yes |
| src/lib/brand.js | 10/0 | yes |
| src/lib/business.js | 182/0 | yes |
| src/lib/config.js (deleted) | 0/30 | yes |
| src/lib/discoverSections.js | 1/1 | yes |
| src/lib/endpoints.js (deleted) | 0/86 | yes |
| src/lib/entityTables.js (deleted) | 0/67 | yes |
| src/lib/format.js (deleted) | 0/22 | yes |
| src/lib/gcrApi.js (deleted) | 0/138 | yes |
| src/lib/industries.js (deleted) | 0/72 | yes |
| src/lib/installToken.js [WIP] | 49/0 | yes |
| src/lib/paperclip.js | 184/12 | yes |
| src/lib/router.js | 30/0 | yes |
| src/lib/schemaDiscovery.js | 11/13 | yes |
| src/lib/storeItems.js | 140/0 | yes |
| src/lib/time.js | 156/0 | yes |
| src/lib/useLoad.js | 67/0 | yes |
| src/lib/writeEntityData.js (deleted) | 0/53 | yes |
| src/main.jsx | 4/0 | yes |
| src/pages/AcceptInvite.jsx | 80/142 | yes (new and old) |
| src/pages/AppStore.jsx (deleted) | 0/153 | yes |
| src/pages/BusinessPicker.jsx | 32/31 | yes |
| src/pages/Claim.jsx (deleted) | 0/221 | yes |
| src/pages/Dashboard.jsx (deleted) | 0/78 | yes |
| src/pages/Login.jsx | 2/2 | yes |
| src/pages/SignUp.jsx | 10/6 | yes |
| src/screens/Activity.jsx | 151/0 | yes |
| src/screens/Agents.jsx | 488/0 | yes |
| src/screens/Apps.jsx | 588/0 | yes |
| src/screens/Automations.jsx | 482/0 | yes |
| src/screens/Business.jsx | 431/0 | yes |
| src/screens/Calendar.jsx | 241/0 | yes |
| src/screens/Computer.jsx | 230/0 | yes |
| src/screens/Home.jsx | 245/0 | yes |
| src/screens/Messages.jsx | 213/0 | yes |
| src/screens/Onboarding.jsx | 627/0 | yes |
| src/screens/Settings.jsx | 740/0 | yes |
| src/sections/EditableSection.jsx (deleted) | 0/74 | yes |
| src/sections/{Events,Generic,HappyHour,Hours,Menu,Offerings,PriceList,Progress}Section.jsx | 22/22 total | yes |
| src/ui/Icon.jsx | 83/0 | yes |
| src/ui/app.css | 676/0 | yes |
| src/ui/ui.jsx | 429/0 | yes |
| vercel.json | 5/0 | yes |
| vite.config.js | 17/12 | yes |

Every Play-user call was checked against the routes mounted on the same branch: gcr-api-clean `server.js` and `routes/*`, and paperclip `server/src/routes/{store,nextgent,access,agents,issues,approvals,routines,costs,activity}.ts`. All routes exist. The mismatches are in the findings below.

### 2. Spec deviations (highest severity first)
1. **E12 / F: automations are not Paperclip routines.** `Automations.jsx:17-18` says "One engine — gcr-api-clean's (lib/automationEngine.js)". Every call goes through `/biz/business/automations*` (`business.js:136-148`). Run, update, drafts and builder all live in the business database (gcr-api-clean `routes/automations.js:449-600`).
   - Paperclip routines are shown separately, in Agents → Schedule (`Agents.jsx:431-457`) and in Calendar (`Calendar.jsx:52,82-87`). That is two automation systems.
   - "Update to vX" (`Automations.jsx:225`, which calls `POST /business/automations/:id/update`) changes versions outside the Paperclip store. This breaks C1, where Paperclip is the version and release authority.
   - Templates, by contrast, install through the Paperclip store (`Automations.jsx:340-361`). So an automation is installed in one system and runs and lists from another.
2. **F: the owner's app area is not built from installed apps.**
   - `nav.js:1-2` says "These ten are the only fixed navigation".
   - The old `Dashboard.jsx` (at cb1d269) built the dashboard from Paperclip `store.menu()`. That call is still defined (`paperclip.js`, `store.menu`) but nothing uses it. The feature was dropped with no replacement.
   - Installed apps are reachable only via Apps → Open (`Apps.jsx:35-37,332-356`). Uninstalling does not remove a surface, because nothing is assembled from installs.
   - Business is the schema-driven table editor, not a set of apps.
   - Calendar shows bookings and availability as a built-in screen (`Calendar.jsx:49-81`), against G: "Bookings … are apps, not built in".
3. **[WIP] F / E8: installed apps can never render.**
   - `appOf()` (`storeItems.js:64-67`) and `InstalledApp.jsx:28-34` need `item.app`/`item.manifest`/`item.payload.app` and `item.installId`/`item.install.id`.
   - Paperclip's `listForCompany` (paperclip `services/store.ts:512-536`) returns none of these fields.
   - So every app shows "The store hasn't sent this app's screen yet (no install id in the store list)". The fallback text itself is developer wording.
4. **D4 / E13 / A1: there is no device association in Paperclip.** Computer, Settings → Computer/Phone and onboarding pairing use only gcr-api-clean `/nodes` (`business.js:159-164`, `Computer.jsx:31,196`). Keeping the relay in gcr-api-clean matches the spec, but nothing records "this device belongs to this company" in Paperclip.
5. **E21 / F: the public page and owner choice of what is public are missing.**
   - The "Show on your public page" switch depends on `item.public` (`Apps.jsx:321,390-395`). Paperclip never sends that field, and its `subscriptionSchema` would strip `{public}` anyway. The switch is dead.
   - The onboarding preview is only the GCR listing (`Onboarding.jsx:578-613`). It shows no installed app blocks and offers no show/hide or ordering.
6. **A: platform state is kept in the business database.** Notification preferences (`business.js:125-132`, `Settings.jsx:316-395`) are per-owner platform settings, stored in gcr-api-clean `/notify-settings`. Billing is listed under section 5 (OPEN).
7. **E6–8: no channel choice at install.** Install records the default channel only. The install sheet offers update mode but not channel (`Apps.jsx:272-278`); channel can only be changed after installing (`Apps.jsx:405-410`).
8. These parts match the spec:
   - Play-user holds no database key.
   - `/biz` uses a short-lived business token issued by Paperclip, kept in memory (`bizToken.js`, `biz.js`, `api/biz/[...path].js`).
   - The slug is never sent for business writes.
   - Linking a company to a business, store, agents, invites and receipts go through Paperclip.
   - E3 is schema-driven, and the hard-coded `industries.js` was removed.

### 3. Owner-rule violations (G)
- **Hard-coding:**
  - Email providers "Gmail or Outlook" (`Onboarding.jsx:431-432,446`).
  - Token lifetime "five minutes" (`Settings.jsx:665`). The server's TTL is configurable.
  - Online window `ONLINE_WINDOW_MS` of 3 minutes (`Computer.jsx:21`).
  - Venue/industry column names in new screens: `event_name`, `artist_name`, `event_date`, `start_time` (`Home.jsx:43,182`; `Calendar.jsx:65-70`) and `availability_date`, `time_slot`, `remaining_spots`, `total_capacity`, `booking_type` (`Calendar.jsx:72-80`).
  - Fact list `SHOWN_FACTS` (`Onboarding.jsx:385`) and the raw-key list at `Calendar.jsx:141`.
  - Brand, currency and public-page URL correctly come from env.
- **Duplicate or stacked pieces:**
  - **Two automation systems** (section 2, item 1).
  - **Two error classes plus a shim:** `paperclip.js` `ApiError`, and `biz.js` `BizError` with alias getters "older screens use" (`biz.js:58-62`). `apiClient.js` exists only to serve `appStore.js`.
  - **Repeated small helpers:** `human`, `capital`, `capitalize` and `capitalWords` are each defined separately (`Automations.jsx:61`, `Activity.jsx:15`, `Agents.jsx:485`, `Calendar.jsx:156`, `Apps.jsx:587`, `Settings.jsx:397`). `list` is defined twice (`Home.jsx:17`, `Calendar.jsx:37`).
  - **Approve/decline logic twice:** `Home.jsx:106-119` and `Agents.jsx:189-226`.
  - **Update-mode setting in three places:** `Apps.jsx` InstallSheet and InstalledSheet, and Settings → Store updates (`Settings.jsx:594-630`).
  - **Permission lists in three places:** Apps, Settings → Permissions and Agents → Permissions.
  - **CSS overrides appended at the end of `app.css`:** `.row`, `.row-text`, `.data-row` and `.cal-dots` are each defined twice.
- **Features dropped without replacement:**
  - The Paperclip menu (old `Dashboard.jsx`).
  - The store item contents line: "Includes N agents/skills/routines" and "Adds to your menu" (old `AppStore.jsx`).
  - The email field on the claim review (old `Claim.jsx`; `ReviewChoice`, `Onboarding.jsx:338-341`, asks only name and phone).
  - Admin-issued business invite links. `#/invite/<token>` is now a Paperclip team invite only, so old gcr `/auth/invite` links stop working. Confirm that Plat-admin covers this.
  - Theme switching and Composio integrations were kept (Settings → Account and Settings → Integrations).
- **Design decisions the spec does not settle:**
  - The ten screens and the phone bottom bar (`nav.js`).
  - The nine-step onboarding (`Onboarding.jsx:24-34`).
  - Fourteen Settings sections citing "plan §10" (`Settings.jsx:21`).
  - "Early access" as the label for the fast channel.
  - "Team member" as the label for the operator role.
  - The rule that declined optional access "can't be added back without reinstalling" (`Apps.jsx:162`).
  - Choosing the assistant as the oldest top-level agent (`useAssistant.js:11-16`).
- **Copied prototype UI:** I found no prototype to compare against, so this is not verified.

### 4. Bugs and security (highest severity first)
1. **[WIP] Deploy breaks.** `package.json` adds `"@nextgent/app-engine": "file:../App-build-/packages/engine"`. It only resolves with a sibling checkout (it is a symlink in `node_modules`). A Vercel build of Play-user alone will fail at install.
2. **High: the `Sheet` steals focus.** `ui.jsx:292-326` re-runs its focus effect whenever `onClose` changes identity. Every caller passes an inline arrow function. On each parent re-render, focus jumps to the outside trigger and then to the sheet's first focusable element (its Close button). Confirmed cases:
   - Business → Edit info: every keystroke (`Business.jsx:153,200-207`). The owner effectively cannot edit business info.
   - Onboarding review request: every keystroke (`Onboarding.jsx:321-345`).
   - New task sheet: every 15 seconds, because Agents polls (`Agents.jsx:37,183,254`).
   - Pair a computer: every 30 seconds, because Computer polls (`Computer.jsx:31,54,208`).
   - Onboarding install review: on every permission toggle (`Onboarding.jsx:532-537`).
3. **High: viewers are trapped in setup.** Paperclip `businessRoleFor` returns 403 for viewers (`nextgent.ts`). `biz.js:51` maps any 403 to `notLinked`, so `BusinessContext.jsx:32` sets `'unlinked'`. `App.jsx:51-57` then forces the setup flow, but only owners and admins may link. Viewers also see a permanent "Finish setting up" banner (`AppShell.jsx:96-101`).
4. **High: the webhook address is wrong.**
   - `api/biz/[...path].js:36` sets `x-forwarded-host` to Play-user's own host.
   - gcr-api-clean `automations.js:444` builds `hook_url` from that header, giving `https://<play-user>/api/automations/hook/<token>`.
   - On Play-user, `/api/*` is forwarded to Paperclip, so the address shown at `Automations.jsx:249-252` does not work.
5. **Medium: possible script injection.** `Agents.jsx:291` calls `window.open(p.url, '_blank', 'noopener')` on a URL supplied by an agent's work product. Paperclip validates it with `z.string().url()`, which accepts `javascript:` URLs, and the opened window inherits the app's origin. Reachable through prompt injection.
6. **Medium [WIP]: an install's long-lived token sits in the browser.**
   - Paperclip's install-token route (`nextgent.ts:169-186`) returns the install's stored token with `expiresAt: null`.
   - `installToken.js:229-243` keeps it for the whole page session.
   - The Security card's claims ("five minutes", "its own key", `Settings.jsx:665-666`) are therefore misleading for apps.
7. **Medium: Activity shows made-up states.**
   - Every receipt shows "Within approved access — no extra approval needed" (`Activity.jsx:114`). The receipt shape has no approval field (`paperclip.js:243-247`), so YES-code approvals (E15–18) never appear.
   - A receipt without a device shows "In the cloud" (`:115`).
   - Ordinary log events show invented "No approval needed" and "Recorded by the platform" check marks (`:122-124`).
8. **Medium: automation drafts are a dead end.** Drafts can be listed but not opened, edited or published (`Automations.jsx:323-338`). The builder supports only one step. Validation problems returned by the server are ignored and the toast still says "Draft saved" (`:406-414`).
9. **Low/Medium: opening a chat creates a task.** `Conversation.jsx:13` sends `POST /companies/:id/chats/:agentRef` as soon as the Ask panel or a Conversation tab opens. That creates an issue and an activity entry. The server's own comment (`issues.ts:17261`) says GET resolves an existing chat and POST is only for the first send.
10. **Low: retrying onboarding installs repeats finished ones.** After a partial failure, `installAll` retries items that already installed, because the store list is not reloaded (`Onboarding.jsx:479-495`).
11. **Low: a promised action is missing.** The Messages banner says a held draft can be dropped (`Messages.jsx:46`), but there is no drop action.
12. **Low: loading buttons stay clickable.** `Button` puts `{...rest}` after `disabled={loading || rest.disabled}` (`ui.jsx:13-15`), so a caller's `disabled={false}` re-enables a loading button. Double submit is possible, for example on Conversation send and Create task.
13. **Low: smaller wrong states.**
    - Calendar pins every agent task to today, whatever its date (`Calendar.jsx:88-91`).
    - Home adds up payments of mixed currencies and labels the total with the first one's currency (`Home.jsx:39-40`).
    - The schema cache key is shared across companies (`schemaDiscovery.js` `SCHEMA_CACHE_KEY`).
    - The forwarding-code poll never stops (`Onboarding.jsx:416`).
    - `refreshTool` is never called after returning from Composio.
14. **Dead code:**
    - `messages.consent` and `messages.numbers` (`business.js:108-109`).
    - `businesses.dashboard`, `agents.org`, `store.menu` and `tasks.get` (`paperclip.js`).
    - `getBizCompany` (`biz.js:22`), `hasSeveral` (`AuthContext.jsx:94`) and `useAction` (`useLoad.js`).
    - The `public` switch UI.
15. **Token handling is otherwise sound.**
    - Business and install tokens are memory-only and dropped on sign-out or company switch.
    - A 401 is retried once with a fresh token.
    - The `/biz` proxy forwards only selected headers, strips cookies, and never sees the Paperclip cookie.
    - I found no `dangerouslySetInnerHTML`.

### 5. Section H: OPEN, owner decides
- **Billing:** the code puts it in gcr-api-clean. That covers `/billing/me|plans|checkout` (`business.js:166-175`), Settings → Billing (`Settings.jsx:521-592`) and the "account paused" banner (`AppShell.jsx:31,104-110`). The note at `Settings.jsx:588` says store charges join the same bill, while the store charges themselves come from Paperclip.
- **Facebook/Google updates through App Maps or official APIs:** the code uses Composio OAuth integrations in gcr-api-clean (Settings → Integrations, `Settings.jsx:477-519`) plus forwarded email. There is no App Map path.
- **Jarvis on the local computer vs the cloud:** the code treats the assistant as a Paperclip cloud agent (`useAssistant.js`, `Conversation.jsx`). The copy says the computer "puts your calendar and agents on your TV" (`Onboarding.jsx:558`).
- **Apps vs modules naming:** the code uses "Apps" throughout (`nav.js`, `Apps.jsx`). Left as is, per the owner.

