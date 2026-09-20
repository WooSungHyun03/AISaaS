import "server-only";
import type { AutomationHandler, AutomationHandlerResult } from "@/types/automation";

/** Placeholder — see AUTOMATION_AVAILABILITY in src/types/automation.ts. */
export const newsletterAutomationHandler: AutomationHandler = {
  templateSlug: "newsletter",
  async run(): Promise<AutomationHandlerResult> {
    throw new Error("Newsletter automation is not implemented yet (Coming Soon).");
  },
};
