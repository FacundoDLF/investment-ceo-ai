import { z } from 'zod';

export const ChallengeStatusSchema = z.enum(['LOCKED', 'ACTIVE', 'COMPLETED', 'FAILED']);

export const ChallengeSchema = z.object({
  id: z.string().uuid(),
  tier: z.number().int(),
  title: z.string(),
  description: z.string(),
  targetMetric: z.number(),
  status: ChallengeStatusSchema.default('LOCKED'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Challenge = z.infer<typeof ChallengeSchema>;
