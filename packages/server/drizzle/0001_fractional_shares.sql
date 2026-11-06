-- Quantities become integer micro-shares (1 share = 1_000_000) to support fractional shares.
UPDATE `executions` SET `quantity` = `quantity` * 1000000;
