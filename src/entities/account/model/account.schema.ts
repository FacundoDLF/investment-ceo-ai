import { z } from 'zod';

export const AccountStatusSchema = z.enum(['ACTIVE', 'LIQUIDATED', 'PAUSED']);

export const AccountSchema = z.object({
  id: z.string().uuid(),
  balance: z.number(),
  status: AccountStatusSchema.default('ACTIVE'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Account = z.infer<typeof AccountSchema>;
