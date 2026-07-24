"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	Input,
	Switch,
} from "@cap/ui";
import type { Video } from "@cap/web-domain";
import {
	faChevronDown,
	faChevronRight,
	faCopy,
	faLink,
	faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	createShareLink,
	deleteShareLink,
	getShareLinkViews,
	listShareLinks,
} from "@/actions/videos/share-links";

interface TrackedLinksDialogProps {
	isOpen: boolean;
	onClose: () => void;
	videoId: Video.VideoId;
	capName: string;
}

const fmt = (d: Date | string | null | undefined) =>
	d ? new Date(d).toLocaleString() : null;

export const TrackedLinksDialog: React.FC<TrackedLinksDialogProps> = ({
	isOpen,
	onClose,
	videoId,
	capName,
}) => {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [sendEmail, setSendEmail] = useState(false);

	const linksQuery = useQuery({
		queryKey: ["share-links", videoId],
		queryFn: () => listShareLinks(videoId),
		enabled: isOpen,
	});

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["share-links", videoId] });

	const copy = (url: string) => {
		navigator.clipboard.writeText(url);
		toast.success("Link copiado al portapapeles");
	};

	const createMutation = useMutation({
		mutationFn: () =>
			createShareLink({
				videoId,
				recipientName: name,
				recipientEmail: email || null,
				sendEmailToRecipient: sendEmail,
			}).then((r) => {
				if (!r.success) throw new Error(r.error);
				return r;
			}),
		onSuccess: (r) => {
			copy(r.link.url);
			if (r.emailed) toast.success(`Correo enviado a ${email}`);
			setName("");
			setEmail("");
			setSendEmail(false);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message || "No se pudo crear el link"),
	});

	const deleteMutation = useMutation({
		mutationFn: (linkId: string) =>
			deleteShareLink(linkId).then((r) => {
				if (!r.success) throw new Error(r.error);
			}),
		onSuccess: () => {
			toast.success("Link eliminado");
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
	});

	const links = linksQuery.data ?? [];
	const canSend = email.trim().length > 0;

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="p-0 w-full max-w-lg rounded-xl border bg-gray-2 border-gray-4">
				<DialogHeader
					icon={<FontAwesomeIcon icon={faLink} className="size-3.5" />}
					description={`Crea links únicos por persona para saber quién ya vio "${capName}"`}
				>
					<DialogTitle>Links de seguimiento</DialogTitle>
				</DialogHeader>

				{/* Create form */}
				<div className="p-5 space-y-3 border-b border-gray-4">
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							placeholder="Nombre del destinatario (ej. Juan)"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
						<Input
							type="email"
							placeholder="Email (opcional)"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					<div className="flex justify-between items-center">
						<div>
							<p className="text-sm font-medium text-gray-12">
								Enviar el link por correo
							</p>
							<p className="mt-1 text-xs text-gray-10">
								{canSend
									? "Se enviará el link al email del destinatario."
									: "Agrega un email para poder enviarlo."}
							</p>
						</div>
						<Switch
							checked={sendEmail && canSend}
							disabled={!canSend}
							onCheckedChange={setSendEmail}
						/>
					</div>
					<Button
						size="sm"
						variant="dark"
						className="w-full"
						spinner={createMutation.isPending}
						disabled={createMutation.isPending || name.trim().length === 0}
						onClick={() => createMutation.mutate()}
					>
						Crear link y copiar
					</Button>
				</div>

				{/* Existing links */}
				<div className="overflow-y-auto p-5 space-y-2 max-h-80">
					{linksQuery.isLoading ? (
						<p className="py-4 text-sm text-center text-gray-10">Cargando…</p>
					) : links.length === 0 ? (
						<p className="py-4 text-sm text-center text-gray-10">
							Aún no hay links de seguimiento para este cap.
						</p>
					) : (
						links.map((link) => (
							<LinkRow
								key={link.id}
								link={link}
								onCopy={() => copy(link.url)}
								onDelete={() => deleteMutation.mutate(link.id)}
								deleting={deleteMutation.isPending}
							/>
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};

type LinkItem = Awaited<ReturnType<typeof listShareLinks>>[number];

const LinkRow: React.FC<{
	link: LinkItem;
	onCopy: () => void;
	onDelete: () => void;
	deleting: boolean;
}> = ({ link, onCopy, onDelete, deleting }) => {
	const [expanded, setExpanded] = useState(false);
	const viewsQuery = useQuery({
		queryKey: ["share-link-views", link.id],
		queryFn: () => getShareLinkViews(link.id),
		enabled: expanded,
	});

	const viewed = Boolean(link.firstViewedAt);

	return (
		<div className="rounded-lg border border-gray-4 bg-gray-1">
			<div className="flex gap-3 items-center p-3">
				<div className="flex-1 min-w-0">
					<div className="flex gap-2 items-center">
						<p className="text-sm font-medium truncate text-gray-12">
							{link.recipientName}
						</p>
						<span
							className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
								viewed
									? "bg-green-100 text-green-700"
									: "bg-gray-4 text-gray-10"
							}`}
						>
							{viewed
								? `Visto ✓ · ${link.viewCount} ${link.viewCount === 1 ? "vez" : "veces"}`
								: "Sin ver"}
						</span>
					</div>
					<p className="text-xs truncate text-gray-10">
						{link.recipientEmail ? `${link.recipientEmail} · ` : ""}
						{viewed
							? `Primera vez: ${fmt(link.firstViewedAt)}`
							: "Nadie lo ha abierto todavía"}
					</p>
				</div>
				<button
					type="button"
					aria-label="Copiar link"
					className="p-2 rounded-md text-gray-10 hover:text-gray-12 hover:bg-gray-3"
					onClick={onCopy}
				>
					<FontAwesomeIcon icon={faCopy} className="size-3.5" />
				</button>
				<button
					type="button"
					aria-label="Eliminar link"
					disabled={deleting}
					className="p-2 rounded-md text-gray-10 hover:text-red-500 hover:bg-gray-3"
					onClick={onDelete}
				>
					<FontAwesomeIcon icon={faTrash} className="size-3.5" />
				</button>
			</div>
			{viewed && (
				<button
					type="button"
					className="flex gap-1.5 items-center px-3 pb-2 w-full text-xs text-gray-10 hover:text-gray-12"
					onClick={() => setExpanded((v) => !v)}
				>
					<FontAwesomeIcon
						icon={expanded ? faChevronDown : faChevronRight}
						className="size-2.5"
					/>
					Detalle de aperturas
				</button>
			)}
			{expanded && (
				<div className="px-3 pb-3 space-y-1">
					{viewsQuery.isLoading ? (
						<p className="text-xs text-gray-10">Cargando…</p>
					) : (viewsQuery.data ?? []).length === 0 ? (
						<p className="text-xs text-gray-10">Sin registros.</p>
					) : (
						(viewsQuery.data ?? []).map((v) => (
							<div
								key={v.id}
								className="flex justify-between text-xs text-gray-11"
							>
								<span>{fmt(v.viewedAt)}</span>
								<span className="text-gray-10">
									{[v.city, v.country].filter(Boolean).join(", ") || "—"}
									{v.browser ? ` · ${v.browser}` : ""}
								</span>
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
};
