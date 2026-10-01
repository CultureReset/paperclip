import { Boxes } from "lucide-react";
import { PRODUCT_NAME } from "@/config/product";
import { cn } from "@/lib/utils";

export function NextGentLockup({ className }: { className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2 text-foreground", className)} aria-label={PRODUCT_NAME}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
        <Boxes className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold tracking-wide">{PRODUCT_NAME}</span>
    </div>
  );
}

