CREATE TABLE `client_isolations_table` (
	`client_a_id` integer NOT NULL,
	`client_b_id` integer NOT NULL,
	PRIMARY KEY(`client_a_id`, `client_b_id`),
	FOREIGN KEY (`client_a_id`) REFERENCES `clients_table`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`client_b_id`) REFERENCES `clients_table`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `clients_table` ADD `isolated` integer DEFAULT false NOT NULL;