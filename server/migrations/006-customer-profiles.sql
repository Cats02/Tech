CREATE TABLE IF NOT EXISTS customer_versions (
    customer_id BIGINT UNSIGNED PRIMARY KEY,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;
