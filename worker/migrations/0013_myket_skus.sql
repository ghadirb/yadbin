-- Myket in-app products (consumable, one purchase = one period). Product IDs as created in the Myket developer panel.
-- Idempotent: only fills the SKU when it is still unset, so a later manual change in D1 is never overwritten.
UPDATE plans SET store_sku = 'pro_monthly' WHERE id = 'pro_monthly' AND store_sku IS NULL;
UPDATE plans SET store_sku = 'pro_yearly'  WHERE id = 'pro_yearly'  AND store_sku IS NULL;
