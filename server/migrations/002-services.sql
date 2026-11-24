CREATE TABLE IF NOT EXISTS services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    home_label VARCHAR(160) NOT NULL,
    short_description VARCHAR(1000) NOT NULL DEFAULT '',
    full_description TEXT NOT NULL,
    home_note VARCHAR(1000) NOT NULL DEFAULT '',
    category ENUM('support','web','cad') NOT NULL DEFAULT 'support',
    icon VARCHAR(20) NOT NULL DEFAULT '',
    amount_cents INT UNSIGNED NULL,
    price_type ENUM('fixed','from','hour','quote') NOT NULL DEFAULT 'from',
    billing_unit ENUM('item','hour') NOT NULL DEFAULT 'item',
    duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
    online_booking BOOLEAN NOT NULL DEFAULT FALSE,
    appointment_types VARCHAR(100) NOT NULL DEFAULT '',
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    show_home BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX services_public (visible, category, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS price_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT UNSIGNED NOT NULL,
    admin_id BIGINT UNSIGNED NOT NULL,
    old_amount_cents INT UNSIGNED NULL,
    new_amount_cents INT UNSIGNED NULL,
    old_price_type VARCHAR(20) NOT NULL,
    new_price_type VARCHAR(20) NOT NULL,
    old_billing_unit VARCHAR(20) NOT NULL,
    new_billing_unit VARCHAR(20) NOT NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (admin_id) REFERENCES admin_users(id),
    INDEX price_history_service (service_id, changed_at)
) ENGINE=InnoDB;

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('general-it-support', 'General IT support', 'General IT support', '', '', '', 'support', '', 7000, 'from', 'hour', 1, 0) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('remote-support', 'Remote support', 'Remote support', '', '', '', 'support', '', 6000, 'from', 'hour', 1, 10) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('on-site-support', 'On-site support', 'On-site support', '', '', 'Plus travel where applicable', 'support', '', 8000, 'from', 'hour', 1, 20) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('computer-diagnosis', 'Computer diagnosis', 'Computer diagnosis', '', '', 'Waived when proceeding with an approved repair', 'support', '', 4500, 'from', 'item', 1, 30) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('computer-clean-up', 'Computer clean-up', 'Computer clean-up', '', '', '', 'support', '', 7000, 'from', 'item', 1, 40) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('virus-and-malware-removal', 'Virus and malware removal', 'Virus and malware removal', '', '', '', 'support', '', 9000, 'from', 'item', 1, 50) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('windows-installation', 'Windows installation', 'Windows installation', '', '', '', 'support', '', 11000, 'from', 'item', 1, 60) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('new-computer-setup', 'New computer setup', 'New computer setup', '', '', '', 'support', '', 8000, 'from', 'item', 1, 70) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('wi-fi-and-router-assistance', 'Wi-Fi and router assistance', 'Wi-Fi and router assistance', '', '', '', 'support', '', 9000, 'from', 'item', 1, 80) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('website-development', 'One-Page Website', 'Website Development', 'Suitable for simple business websites, landing pages, portfolios or an online presence with essential information.', '', 'Responsive websites for individuals, sole traders and small businesses', 'web', '▤', 29900, 'from', 'item', 1, 90) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('3d-printing', '3D Printing', '3D printing', 'Custom 3D printing for prototypes, replacement components, custom parts and one-off creations.', '', 'Varies by material, print time, complexity and finishing', 'cad', '▤', 2000, 'from', 'item', 1, 100) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('cad-design', 'CAD Design', 'CAD design', 'Custom 3D modelling, design modifications and digital designs tailored to individual project requirements.', '', '', 'cad', '△', 5000, 'hour', 'hour', 1, 110) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('cad-design-plus-3d-printing', 'CAD Design + 3D Printing', 'CAD design + 3D printing', 'A complete design-to-print service for customers with an idea, sketch, measurements or existing component but no printable 3D model.', '', '', 'cad', '◇', NULL, 'quote', 'item', 1, 120) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('starter-website-2-3-pages', 'Starter Website (2–3 pages)', 'Starter Website (2–3 pages)', 'Suitable for small businesses needing separate pages for services, business information and contact details.', '', '', 'web', '▥', 49900, 'from', 'item', 0, 130) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('small-business-website-4-5-pages', 'Small Business Website (4–5 pages)', 'Small Business Website (4–5 pages)', 'A more complete website for businesses requiring multiple service and information pages.', '', '', 'web', '▦', 69900, 'from', 'item', 0, 140) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('larger-websites-6-10-pages', 'Larger Websites (6–10 pages)', 'Larger Websites (6–10 pages)', 'Pricing varies depending on the number of pages, functionality and complexity.', '', '', 'web', '▧', 99900, 'from', 'item', 0, 150) ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO services (slug, name, home_label, short_description, full_description, home_note, category, icon, amount_cents, price_type, billing_unit, show_home, sort_order) VALUES ('custom-website', 'Custom Website', 'Custom Website', 'A tailored option for projects with individual design, content or functionality requirements.', '', '', 'web', '</>', NULL, 'quote', 'item', 0, 160) ON DUPLICATE KEY UPDATE slug = VALUES(slug);
