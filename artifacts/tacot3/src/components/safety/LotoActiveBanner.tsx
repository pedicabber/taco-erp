import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { LotoBannerItem } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";

/**
 * Company-wide warning banner shown on a project page whenever the project has
 * one or more LOTO records that are active or pending release. Visible to any
 * authenticated user (the underlying endpoint is not gated by Safety access).
 */
export default function LotoActiveBanner({ projectId }: { projectId: number }) {
  const { data } = useQuery<LotoBannerItem[]>({
    queryKey: ["project-active-loto", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/active-loto`).then((r) => r.data),
    refetchInterval: 60000,
  });

  const items = data ?? [];
  if (items.length === 0) return null;

  const hasCritical = items.some((i) => i.severity === "critical");

  return (
    <div
      className={`mb-5 rounded-lg border-2 px-4 py-3 ${
        hasCritical
          ? "border-red-500 bg-red-500/10"
          : "border-amber-500 bg-amber-500/10"
      }`}
      data-testid="banner-active-loto"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`w-6 h-6 flex-shrink-0 mt-0.5 ${
            hasCritical ? "text-red-600" : "text-amber-600"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className={`font-bold ${hasCritical ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            ⚠ ACTIVE LOTO EXISTS
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Energy isolation is in effect on this project. Do not re-energize without
            LOTO Commander authorization.
          </p>
          <ul className="mt-2 space-y-1">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/safety?loto=${i.id}`}>
                  <span className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer hover:underline">
                    <span className="font-mono">{i.lotoNumber}</span>
                    <span className="truncate">{i.equipmentName}</span>
                    {i.severity === "critical" && (
                      <span className="text-xs font-semibold uppercase text-red-600">critical</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {i.status === "pending_release" ? "(pending release)" : "(active)"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
