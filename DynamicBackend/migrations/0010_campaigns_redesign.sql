PRAGMA foreign_keys = ON;

CREATE TABLE `campaigns` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `client_id` text NOT NULL,
  `bot_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `languages_json` text DEFAULT '[]' NOT NULL,
  `columns_schema_json` text NOT NULL,
  `scheduled_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `campaigns_admin_created` ON `campaigns` (`admin_id`, `created_at`);
CREATE INDEX `campaigns_client` ON `campaigns` (`client_id`);
CREATE INDEX `campaigns_bot` ON `campaigns` (`bot_id`);

ALTER TABLE `campaign_leads` ADD COLUMN `campaign_id` text REFERENCES `campaigns`(`id`) ON DELETE cascade;
ALTER TABLE `campaign_leads` ADD COLUMN `data_json` text;
ALTER TABLE `campaign_leads` ADD COLUMN `extra_data_json` text;

DROP INDEX IF EXISTS `campaign_leads_admin_client_ref_unique`;
CREATE INDEX `campaign_leads_campaign` ON `campaign_leads` (`campaign_id`);
CREATE UNIQUE INDEX `campaign_leads_admin_campaign_ref_unique` ON `campaign_leads` (`admin_id`, `campaign_id`, `reference_id`);
