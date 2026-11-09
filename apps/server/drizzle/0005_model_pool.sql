ALTER TABLE `anchors` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `enabled_models` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
-- 数据迁移：去掉「服务商默认模型」兜底前，把它写进用到它的配置
UPDATE `anchor_configs` SET `model` = (SELECT `default_model` FROM `providers` WHERE `providers`.`id` = `anchor_configs`.`provider_id`)
WHERE (`model` IS NULL OR trim(`model`) = '') AND `provider_id` IS NOT NULL;--> statement-breakpoint
-- 模型池：默认模型 + 配置里用到的模型
UPDATE `providers` SET `enabled_models` = (
  SELECT coalesce(json_group_array(m), '[]') FROM (
    SELECT `default_model` AS m WHERE `default_model` IS NOT NULL AND trim(`default_model`) <> ''
    UNION
    SELECT `model` FROM `anchor_configs` WHERE `anchor_configs`.`provider_id` = `providers`.`id` AND `model` IS NOT NULL AND trim(`model`) <> ''
  )
);--> statement-breakpoint
UPDATE `anchors` SET `source` = 'import' WHERE `name` IN (SELECT `anchor_name` FROM `sessions` WHERE `source` = 'import');--> statement-breakpoint
-- 回复配置不再属于某个主播，名称改为全局唯一：重名的加上原主播名
UPDATE `anchor_configs` SET `name` = `name` || '（' || `anchor_name` || '）'
WHERE EXISTS (
  SELECT 1 FROM `anchor_configs` AS o
  WHERE o.`name` = `anchor_configs`.`name` AND o.`id` <> `anchor_configs`.`id`
    AND (o.`created_at` < `anchor_configs`.`created_at` OR (o.`created_at` = `anchor_configs`.`created_at` AND o.`id` < `anchor_configs`.`id`))
);
