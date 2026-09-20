import "server-only";
import type { AutomationHandler, AutomationHandlerResult } from "@/types/automation";

/** Placeholder — see AUTOMATION_AVAILABILITY in src/types/automation.ts. */
export const instagramAutomationHandler: AutomationHandler = {
  templateSlug: "instagram-marketing",
  async run(): Promise<AutomationHandlerResult> {
    throw new Error("Instagram automation is not implemented yet (Coming Soon).");
  },
};
