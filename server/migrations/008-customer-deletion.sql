-- Preserve booking snapshots when their separate customer profile is deleted.
ALTER TABLE bookings MODIFY COLUMN customer_id BIGINT UNSIGNED NULL;
