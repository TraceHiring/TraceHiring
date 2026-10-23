// The ABH-7 share metric (spec m1 §6.3, AT-M1-06): `v_item_bank_quant_share` (M1-a, security_invoker) counts, per
// workspace the caller can read, the `quant` items with an approved version and how many of them are parameterised.
// The api sums the rows and divides; with no approved quant item the share is null (no division by zero).
import { z } from 'zod';

export const QuantShareRow = z.object({
  quant_items_approved: z.coerce.number().int().min(0),
  quant_items_parameterised: z.coerce.number().int().min(0),
});

export interface QuantShare {
  quantItemsApproved: number;
  quantItemsParameterised: number;
  share: number | null;
}

export const quantShareOf = (rows: readonly z.infer<typeof QuantShareRow>[]): QuantShare => {
  let approved = 0;
  let parameterised = 0;
  for (const r of rows) {
    approved += r.quant_items_approved;
    parameterised += r.quant_items_parameterised;
  }
  return {
    quantItemsApproved: approved,
    quantItemsParameterised: parameterised,
    share: approved === 0 ? null : parameterised / approved,
  };
};
