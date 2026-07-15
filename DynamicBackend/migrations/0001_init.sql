PRAGMA foreign_keys = ON;

CREATE TABLE `admins` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `logo_url` text,
  `primary_color` text DEFAULT '#8248A5' NOT NULL,
  `secondary_color` text DEFAULT '#a855f7' NOT NULL,
  `nav_bg_color` text DEFAULT '#F2F7FA' NOT NULL,
  `font_family` text DEFAULT 'Poppins, system-ui, sans-serif' NOT NULL,
  `bq_project_id` text,
  `bq_dataset_id` text,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `admins_slug_unique` ON `admins` (`slug`);

CREATE TABLE `clients` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `clients_admin_idx` ON `clients` (`admin_id`);

CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `role` text NOT NULL,
  `client_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `users_admin_email_unique` ON `users` (`admin_id`, `email`);
CREATE INDEX `users_admin_idx` ON `users` (`admin_id`);

CREATE TABLE `bots` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `client_id` text,
  `name` text NOT NULL,
  `external_ref` text NOT NULL,
  `meta_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `bots_admin_idx` ON `bots` (`admin_id`);
CREATE INDEX `bots_client_idx` ON `bots` (`client_id`);
CREATE UNIQUE INDEX `bots_admin_external_unique` ON `bots` (`admin_id`, `external_ref`);

CREATE TABLE `ui_configs` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `client_id` text,
  `page` text NOT NULL,
  `config_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `ui_configs_admin_page_idx` ON `ui_configs` (`admin_id`, `page`);

CREATE TABLE `bot_call_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `bot_id` text NOT NULL,
  `client_id` text,
  `occurred_at` integer NOT NULL,
  `direction` text NOT NULL DEFAULT 'outbound',
  `customer_number` text,
  `duration_sec` integer,
  `action_summary` text,
  `meta_json` text,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `bot_call_logs_bot_occurred` ON `bot_call_logs` (`bot_id`, `occurred_at`);

CREATE TABLE `bot_analytics_rows` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `bot_id` text NOT NULL,
  `client_id` text,
  `occurred_at` integer NOT NULL,
  `meta_json` text NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `bot_analytics_bot_occurred` ON `bot_analytics_rows` (`bot_id`, `occurred_at`);

CREATE TABLE `campaign_leads` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `client_id` text NOT NULL,
  `bot_id` text NOT NULL,
  `reference_id` text NOT NULL,
  `party_name` text,
  `party_mobile` text,
  `emi_amount` text,
  `emi_date` text,
  `loan_type` text,
  `preferred_language` text,
  `call_status` text NOT NULL DEFAULT 'pending',
  `scheduled_at` integer,
  `file_name` text,
  `upload_batch_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `campaign_leads_admin_created` ON `campaign_leads` (`admin_id`, `created_at`);
CREATE INDEX `campaign_leads_client` ON `campaign_leads` (`client_id`);
CREATE UNIQUE INDEX `campaign_leads_admin_client_ref_unique` ON `campaign_leads` (`admin_id`, `client_id`, `reference_id`);
