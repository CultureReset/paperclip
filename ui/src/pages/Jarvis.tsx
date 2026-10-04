import { useQuery } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { useDialogActions } from "@/context/DialogContext";
import { ASSISTANT_NAME } from "@/config/product";
import { queryKeys } from "@/lib/queryKeys";
import { Navigate } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";

/**
 * Stable customer entry point for the primary assistant.
 *
 * New NEXT GENT organizations name the first agent Jarvis. Existing Paperclip
 * organizations remain usable: when no Jarvis-named agent exists, their first
 * active agent becomes the front door instead of forcing a migration.
 */
export function Jarvis() {
  const { selectedCompanyId } = useCompany();
  const { openOnboarding } = useDialogActions();
  const agents = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  if (!selectedCompanyId || agents.isPending) {
    return (
      <div className="flex min-h-(--sz-20rem) items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading {ASSISTANT_NAME}</span>
      </div>
    );
  }

  if (agents.error) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-10">
        <h1 className="text-xl font-semibold">{ASSISTANT_NAME} is unavailable</h1>
        <p className="text-sm text-destructive">{agents.error.message}</p>
        <Button variant="outline" onClick={() => void agents.refetch()}>Try again</Button>
      </div>
    );
  }

  const activeAgents = (agents.data ?? []).filter((agent) => agent.status !== "terminated");
  const jarvis = activeAgents.find((agent) => agent.metadata?.nextgentAssistant === true)
    ?? activeAgents.find((agent) => agent.name.trim().toLowerCase() === ASSISTANT_NAME.toLowerCase())
    ?? activeAgents[0];

  if (jarvis) {
    return <Navigate to={`/chats/${encodeURIComponent(agentRouteRef(jarvis))}`} replace />;
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 py-10">
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
        <Bot className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Create {ASSISTANT_NAME}</h1>
        <p className="text-sm text-muted-foreground">
          Connect a model and create your first agent. {ASSISTANT_NAME} will become your main point of contact and coordinate work through this organization.
        </p>
      </div>
      <Button onClick={() => openOnboarding()}>Set up {ASSISTANT_NAME}</Button>
    </div>
  );
}
