import { z } from "zod";

/**
 * Single source of truth for `directory_tools.classification_source`.
 * Mirrors the category/status pattern (taxonomy.ts/status.ts): any change
 * here must ship with a new migration that re-creates
 * `directory_tools_classification_source_check` (same constraint name)
 * with the same values — classification-source.test.ts finds the
 * highest-numbered migration mentioning that name and asserts it matches
 * this list.
 *
 * `null` (not a third enum value) means "not classified through this
 * pipeline" — a human-set category (seed data, manual edit) rather than
 * something classifyDirectoryTool() produced.
 */
export const CLASSIFICATION_SOURCES = ["ai", "keyword"] as const;

export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const classificationSourceSchema = z.enum(CLASSIFICATION_SOURCES);
