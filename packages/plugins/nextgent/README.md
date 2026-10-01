# NEXT GENT Paperclip capability surface

This package adds one NEXT GENT sidebar/page to Paperclip. It is intentionally
not a second dashboard.

## First capability: Research Assistant

Research Assistant is a Paperclip-managed employee backed by the existing
`hermes_gateway` adapter.

Enable lifecycle:

1. Click **Enable** in NEXT GENT.
2. Paperclip reconciles the managed Research Assistant in a paused state.
3. If company policy requires a hire approval, approve it in Paperclip.
4. Open the Research Assistant's normal Paperclip **Configuration** tab.
5. Enter the Hermes `API_SERVER_KEY`. Paperclip stores this field as a secret
   reference because the Hermes adapter declares it secret.
6. Return to NEXT GENT and click **Enable** again.
7. The plugin resumes the employee.

Disable lifecycle:

- **Disable** pauses the managed employee.
- It does not terminate the agent.
- Existing issues, runs, results, files, and history remain in Paperclip.

## Runtime prerequisite

Start Hermes before assigning work:

```bash
API_SERVER_ENABLED=true \
API_SERVER_KEY=<generated-secret> \
hermes gateway run --replace --accept-hooks
```

The managed agent defaults to:

- Hermes API: `http://127.0.0.1:8642`
- Paperclip: `http://127.0.0.1:3100`
- session key: `issue`
- timeout: 600 seconds

Those settings remain editable through Paperclip's normal agent Configuration
surface; managed reconcile preserves operator edits.

## Build and install from this Paperclip checkout

```bash
pnpm --filter @nextgent/paperclip-plugin build
pnpm paperclipai run
pnpm paperclipai plugin install "$(pwd)/packages/plugins/nextgent"
pnpm paperclipai plugin list
pnpm paperclipai plugin inspect nextgent.capabilities
```

After installation, select a company and the **NEXT GENT** entry appears in the
Paperclip sidebar.

For an image/distribution build, package this plugin as a distribution plugin
and select it through Paperclip's existing `plugins.autoInstall` mechanism
rather than requiring the customer to run the CLI manually.

## Acceptance test

1. Enable and configure Research Assistant.
2. Through Jarvis, create a Paperclip issue assigned to Research Assistant:
   "Research this business and attach a report."
3. Paperclip starts Hermes via `hermes_gateway`.
4. Hermes reports the result back to the Paperclip issue.
5. Jarvis reads the Paperclip task and reports the completed result.

A direct Hermes reply that does not return through Paperclip is not a passing
test.
