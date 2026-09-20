import "server-only";
import type { AutomationHandler, AutomationHandlerResult } from "@/types/automation";

/** Placeholder — see AUTOMATION_AVAILABILITY in src/types/automation.ts. */
export const customerSupportAutomationHandler: AutomationHandler = {
  templateSlug: "customer-support",
  async run(): Promise<AutomationHandlerResult> {
    throw new Error("Customer support automation is not implemented yet (Coming Soon).");
  },
};
