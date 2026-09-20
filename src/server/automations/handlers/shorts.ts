import "server-only";
import type { AutomationHandler, AutomationHandlerResult } from "@/types/automation";

/** Placeholder — see AUTOMATION_AVAILABILITY in src/types/automation.ts. */
export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",
  async run(): Promise<AutomationHandlerResult> {
    throw new Error("Shorts automation is not implemented yet (Coming Soon).");
  },
};
