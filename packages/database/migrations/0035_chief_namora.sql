CREATE TABLE `video_share_link_views` (
	`id` varchar(15) NOT NULL,
	`shareLinkId` varchar(15) NOT NULL,
	`videoId` varchar(15) NOT NULL,
	`viewedAt` timestamp NOT NULL DEFAULT (now()),
	`country` varchar(255),
	`city` varchar(255),
	`browser` varchar(255),
	`os` varchar(255),
	`deviceType` varchar(255),
	CONSTRAINT `video_share_link_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_share_links` (
	`id` varchar(15) NOT NULL,
	`videoId` varchar(15) NOT NULL,
	`recipientName` varchar(255) NOT NULL,
	`recipientEmail` varchar(255),
	`createdByUserId` varchar(15) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`firstViewedAt` timestamp,
	`lastViewedAt` timestamp,
	`viewCount` int NOT NULL DEFAULT 0,
	CONSTRAINT `video_share_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `video_share_link_views` ADD CONSTRAINT `video_share_link_views_shareLinkId_video_share_links_id_fk` FOREIGN KEY (`shareLinkId`) REFERENCES `video_share_links`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_share_links` ADD CONSTRAINT `video_share_links_videoId_videos_id_fk` FOREIGN KEY (`videoId`) REFERENCES `videos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `video_share_link_views_link_id_idx` ON `video_share_link_views` (`shareLinkId`);--> statement-breakpoint
CREATE INDEX `video_share_link_views_video_id_idx` ON `video_share_link_views` (`videoId`);--> statement-breakpoint
CREATE INDEX `video_share_links_video_id_idx` ON `video_share_links` (`videoId`);--> statement-breakpoint
CREATE INDEX `video_share_links_created_by_idx` ON `video_share_links` (`createdByUserId`);