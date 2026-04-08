import { useEffect, useState } from "react";

export function useLiveTimer(
  elapsedSeconds: number,
  timerRunning: boolean,
  timerStartedAt: string | null
): number {
  const [live, setLive] = useState<number>(() => {
    if (timerRunning && timerStartedAt) {
      return elapsedSeconds + Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000);
    }
    return elapsedSeconds;
  });

  useEffect(() => {
    if (!timerRunning || !timerStartedAt) {
      setLive(elapsedSeconds);
      return;
    }

    const baseMs = new Date(timerStartedAt).getTime();
    const update = () => {
      setLive(elapsedSeconds + Math.floor((Date.now() - baseMs) / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timerRunning, timerStartedAt, elapsedSeconds]);

  return live;
}
