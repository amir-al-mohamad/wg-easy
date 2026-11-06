-- The setting answers lookups on the tunnel address; nothing is intercepted.
ALTER TABLE `routing_config_table` RENAME COLUMN `dns_intercept_enabled` TO `dns_proxy_enabled`;
