CREATE TABLE `gateways_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interface_name` text NOT NULL,
	`name` text NOT NULL,
	`fwmark` text NOT NULL,
	`route_table` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_table_interface_name_unique` ON `gateways_table` (`interface_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_table_fwmark_unique` ON `gateways_table` (`fwmark`);--> statement-breakpoint
CREATE UNIQUE INDEX `gateways_table_route_table_unique` ON `gateways_table` (`route_table`);--> statement-breakpoint
CREATE TABLE `port_forwards_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`client_id` integer NOT NULL,
	`external_port` integer NOT NULL,
	`internal_port` integer NOT NULL,
	`protocol` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_port_protocol_unique` ON `port_forwards_table` (`external_port`,`protocol`);--> statement-breakpoint
CREATE TABLE `routing_config_table` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_action` text DEFAULT 'direct' NOT NULL,
	`default_gateway_id` integer,
	`dns_upstreams` text NOT NULL,
	`dns_intercept_enabled` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`default_gateway_id`) REFERENCES `gateways_table`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `routing_rules_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`action` text NOT NULL,
	`gateway_id` integer,
	`patterns` text NOT NULL,
	`addresses` text NOT NULL,
	`auto_resolve` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`gateway_id`) REFERENCES `gateways_table`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `routing_rule_clients_table` (
	`rule_id` integer NOT NULL,
	`client_id` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `client_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `routing_rules_table`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients_table`(`id`) ON UPDATE cascade ON DELETE cascade
);

--> statement-breakpoint
-- Single configuration row, mirroring general_table.
INSERT INTO `routing_config_table`
  (`id`, `default_action`, `default_gateway_id`, `dns_upstreams`, `dns_intercept_enabled`)
VALUES
  (1, 'direct', NULL, '["1.1.1.1","8.8.8.8"]', 0);
