"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { advanceAutomationRun } from "@/app/(app)/automations/actions";

/** Keeps a deferred run moving while its result page is open (the cron tick does the same when nobody is looking). */
export function RunProgress({ automationId }: { automationId: string }) {
  const router = useRouter();
  const stepping = useRef(false);
  useEffect(() => {
    const step = async () => {
      if (stepping.current) return;
      stepping.current = true;
      try {
        await advanceAutomationRun(automationId);
      } catch {
        // The next tick retries.
      } finally {
        stepping.current = false;
        router.refresh();
      }
    };
    const timer = window.setInterval(() => void step(), 6_000);
    void step();
    return () => window.clearInterval(timer);
  }, [automationId, router]);
  return null;
}
