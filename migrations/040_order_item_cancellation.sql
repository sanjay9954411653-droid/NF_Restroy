-- Allow an individual line item to be cancelled without cancelling its order.
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'CANCELLED';
