import { z } from "zod";

/**
 * A question shouldn't be a paragraph; an answer can be a bit longer but
 * still isn't an essay. Bounds exist so a single FAQ can't blow up the
 * prompt budget once #9 feeds these into an AI answer.
 */
const QUESTION_MAX_LENGTH = 300;
const ANSWER_MAX_LENGTH = 2000;

export const createBusinessFaqSchema = z.object({
  businessId: z.string().uuid(),
  question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
  answer: z.string().trim().min(1).max(ANSWER_MAX_LENGTH),
});
export type CreateBusinessFaqInput = z.infer<typeof createBusinessFaqSchema>;

/**
 * No `businessId` here on purpose — which FAQ belongs to which business is
 * fixed at creation time, not something an update can move. `id` (which row)
 * is passed as a separate argument to updateBusinessFaq(), not part of this
 * schema.
 */
export const updateBusinessFaqSchema = z
  .object({
    question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH).optional(),
    answer: z.string().trim().min(1).max(ANSWER_MAX_LENGTH).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((value) => value.question !== undefined || value.answer !== undefined || value.isEnabled !== undefined, {
    message: "At least one of question/answer/isEnabled must be provided.",
  });
export type UpdateBusinessFaqInput = z.infer<typeof updateBusinessFaqSchema>;
