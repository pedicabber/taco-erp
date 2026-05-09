import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { AnimatePresence, motion } from "framer-motion";
import { apiClient } from "@/lib/apiClient";
import tacoLoaderFallback from "@assets/ERP_LOADING_TACO_INGREDIENTS_1778307541116.webm";

const SHOW_DELAY_MS = 300;

const VIDEO_EXT_RE = /\.(webm|mp4|mov)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(gif|png|apng|webp|jpg|jpeg)(\?|#|$)/i;

function useLoadingMediaUrl(): string | null {
  const { isSignedIn } = useAuth();
  const { data } = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => apiClient.get("/settings").then(r => r.data),
    enabled: !!isSignedIn,
    staleTime: 60_000,
    // Mark as background so it does NOT itself trigger the loading overlay.
    meta: { background: true },
  });
  return data?.loading_media_url ?? null;
}

export function TacoLoadingScreen() {
  const customUrl = useLoadingMediaUrl();
  const [errored, setErrored] = useState(false);

  // Reset the error flag whenever the source URL changes so a new upload
  // gets a fresh attempt instead of being permanently stuck on the fallback.
  useEffect(() => {
    setErrored(false);
  }, [customUrl]);

  const useCustom = !!customUrl && !errored;
  const src = useCustom ? customUrl! : tacoLoaderFallback;
  const isVideo = useCustom
    ? VIDEO_EXT_RE.test(customUrl!) || !IMAGE_EXT_RE.test(customUrl!)
    : true;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      data-testid="global-loading-overlay"
    >
      {isVideo ? (
        <video
          key={src}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setErrored(true)}
          className="max-w-[320px] max-h-[320px] w-auto h-auto object-contain bg-transparent"
        />
      ) : (
        <img
          key={src}
          src={src}
          alt=""
          onError={() => setErrored(true)}
          className="max-w-[320px] max-h-[320px] w-auto h-auto object-contain bg-transparent"
        />
      )}
    </motion.div>
  );
}

export function GlobalLoadingOverlay() {
  const fetchingCount = useIsFetching({
    predicate: (q) => !(q.meta as { background?: boolean } | undefined)?.background,
  });
  const mutatingCount = useIsMutating();
  const isLoading = fetchingCount + mutatingCount > 0;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  return (
    <AnimatePresence>{visible && <TacoLoadingScreen key="global-loading-overlay" />}</AnimatePresence>
  );
}

export default GlobalLoadingOverlay;
