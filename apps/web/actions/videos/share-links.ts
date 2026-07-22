"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { sendEmail } from "@cap/database/emails/config";
import { ShareLinkEmail } from "@cap/database/emails/share-link";
import { nanoId } from "@cap/database/helpers";
import {
	videoShareLinks,
	videoShareLinkViews,
	videos,
} from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import type { Video } from "@cap/web-domain";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Unique per-recipient share links. These are additive: the normal
 * /s/:videoId links are unchanged. A unique link is the same public URL plus a
 * `?u=<token>` identifier so the owner can tell whether a specific recipient
 * opened the cap. View recording happens in /api/analytics/track.
 */

async function requireVideoOwner(videoId: Video.VideoId) {
	const user = await getCurrentUser();
	if (!user) throw new Error("Unauthorized");
	const [video] = await db()
		.select({ ownerId: videos.ownerId, name: videos.name })
		.from(videos)
		.where(eq(videos.id, videoId));
	if (!video || video.ownerId !== user.id) throw new Error("Unauthorized");
	return { user, video };
}

export async function createShareLink(input: {
	videoId: Video.VideoId;
	recipientName: string;
	recipientEmail?: string | null;
	sendEmailToRecipient?: boolean;
}) {
	try {
		const recipientName = input.recipientName?.trim();
		if (!recipientName)
			return { success: false as const, error: "Recipient name is required" };

		const recipientEmail = input.recipientEmail?.trim() || null;
		if (input.sendEmailToRecipient && !recipientEmail)
			return {
				success: false as const,
				error: "An email is required to send the link",
			};

		const { user, video } = await requireVideoOwner(input.videoId);

		const id = nanoId();
		const now = new Date();
		await db().insert(videoShareLinks).values({
			id,
			videoId: input.videoId,
			recipientName,
			recipientEmail,
			createdByUserId: user.id,
			createdAt: now,
			updatedAt: now,
			viewCount: 0,
		});

		const url = `${serverEnv().WEB_URL}/s/${input.videoId}?u=${id}`;

		let emailed = false;
		if (input.sendEmailToRecipient && recipientEmail) {
			try {
				await sendEmail({
					email: recipientEmail,
					subject: `${user.name ? `${user.name} shared a video` : "A video was shared with you"}: ${video.name}`,
					react: ShareLinkEmail({
						email: recipientEmail,
						url,
						videoName: video.name,
						senderName: user.name ?? undefined,
					}),
				});
				emailed = true;
			} catch (error) {
				console.error("Failed to send share-link email:", error);
			}
		}

		revalidatePath("/dashboard/caps");
		return {
			success: true as const,
			emailed,
			link: {
				id,
				recipientName,
				recipientEmail,
				url,
				viewCount: 0,
				firstViewedAt: null as Date | null,
				lastViewedAt: null as Date | null,
				createdAt: now,
			},
		};
	} catch (error) {
		console.error("Error creating share link:", error);
		return { success: false as const, error: "Failed to create link" };
	}
}

export async function listShareLinks(videoId: Video.VideoId) {
	await requireVideoOwner(videoId);
	const links = await db()
		.select()
		.from(videoShareLinks)
		.where(eq(videoShareLinks.videoId, videoId))
		.orderBy(desc(videoShareLinks.createdAt));

	const webUrl = serverEnv().WEB_URL;
	return links.map((l) => ({ ...l, url: `${webUrl}/s/${videoId}?u=${l.id}` }));
}

export async function getShareLinkViews(linkId: string) {
	const user = await getCurrentUser();
	if (!user) throw new Error("Unauthorized");
	const [row] = await db()
		.select({ ownerId: videos.ownerId })
		.from(videoShareLinks)
		.innerJoin(videos, eq(videoShareLinks.videoId, videos.id))
		.where(eq(videoShareLinks.id, linkId));
	if (!row || row.ownerId !== user.id) throw new Error("Unauthorized");

	return db()
		.select()
		.from(videoShareLinkViews)
		.where(eq(videoShareLinkViews.shareLinkId, linkId))
		.orderBy(desc(videoShareLinkViews.viewedAt));
}

export async function deleteShareLink(linkId: string) {
	try {
		const user = await getCurrentUser();
		if (!user) throw new Error("Unauthorized");
		const [row] = await db()
			.select({ ownerId: videos.ownerId, videoId: videoShareLinks.videoId })
			.from(videoShareLinks)
			.innerJoin(videos, eq(videoShareLinks.videoId, videos.id))
			.where(eq(videoShareLinks.id, linkId));
		if (!row || row.ownerId !== user.id) throw new Error("Unauthorized");

		await db().delete(videoShareLinks).where(eq(videoShareLinks.id, linkId));
		revalidatePath("/dashboard/caps");
		return { success: true as const };
	} catch (error) {
		console.error("Error deleting share link:", error);
		return { success: false as const, error: "Failed to delete link" };
	}
}
