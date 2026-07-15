PRAGMA foreign_keys = ON;

CREATE TABLE `agent_activity_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_id` text NOT NULL,
  `client_id` text,
  `user_id` text,
  `bot_id` text,
  `action` text NOT NULL,
  `title` text NOT NULL,
  `message` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `agent_activity_logs_admin_idx` ON `agent_activity_logs` (`admin_id`, `created_at`);
CREATE INDEX `agent_activity_logs_client_idx` ON `agent_activity_logs` (`client_id`, `created_at`);
CREATE INDEX `agent_activity_logs_bot_idx` ON `agent_activity_logs` (`bot_id`, `created_at`);
