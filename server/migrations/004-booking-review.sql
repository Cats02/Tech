CREATE TABLE IF NOT EXISTS calendar_lock (
    id TINYINT UNSIGNED PRIMARY KEY
) ENGINE=InnoDB;
INSERT INTO calendar_lock (id) VALUES (1) ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS booking_review (
    booking_id BIGINT UNSIGNED PRIMARY KEY,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    proposed_start DATETIME(3) NULL,
    proposed_end DATETIME(3) NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS calendar_reservations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT UNSIGNED NULL UNIQUE,
    kind ENUM('BOOKING','BLOCKED') NOT NULL DEFAULT 'BOOKING',
    start_at DATETIME(3) NOT NULL,
    end_at DATETIME(3) NOT NULL,
    label VARCHAR(160) NOT NULL DEFAULT '',
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    INDEX calendar_interval (start_at,end_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT UNSIGNED NOT NULL,
    admin_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(20) NOT NULL,
    previous_status VARCHAR(20) NOT NULL,
    new_status VARCHAR(20) NOT NULL,
    start_at DATETIME(3) NULL,
    end_at DATETIME(3) NULL,
    note TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (admin_id) REFERENCES admin_users(id),
    INDEX booking_events_history (booking_id,id)
) ENGINE=InnoDB;
