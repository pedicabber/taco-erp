import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import tacoLoader from "@assets/ERP_LOADING_TACO_INGREDIENTS_1778295631141.mp4";

const SHOW_DELAY_MS = 300;

export function TacoLoadingScreen() {
  // mix-blend-mode "multiply" multiplies the video pixels with the underlying
  // dimmed overlay. Pure-white pixels (the baked-in light background of the
  // mp4) become transparent on top of the dim layer in both light and dark
  // themes, while the colored taco-ingredient artwork stays visible. This is
  // a best-effort CSS-only workaround — the source mp4 itself is opaque, so a
  // transparent .webm (VP9 alpha) or animated .png/.gif would give a perfect
  // result.
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
      <video
        src={tacoLoader}
        autoPlay
        muted
        loop
        playsInline
        className="max-w-[320px] max-h-[320px] w-auto h-auto object-contain"
        style={{ mixBlendMode: "multiply", backgroundColor: "transparent" }}
      />
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
