import "server-only";
import type { AutomationHandler } from "@/types/automation";
import type { AutomationTemplateSlug } from "@/types/domain";
import { blogAutomationHandler } from "./blog";
import { instagramAutomationHandler } from "./instagram";
import { customerSupportAutomationHandler } from "./customer-support";
import { shortsAutomationHandler } from "./shorts";

const registry: Record<AutomationTemplateSlug, AutomationHandler> = {
  "blog-marketing": blogAutomationHandler,
  "instagram-marketing": instagramAutomationHandler,
  "customer-support": customerSupportAutomationHandler,
  shorts: shortsAutomationHandler,
};

export function getHandler(slug: string): AutomationHandler {
  const handler = registry[slug as AutomationTemplateSlug];
  if (!handler) throw new Error(`No automation handler registered for template: ${slug}`);
  return handler;
}
