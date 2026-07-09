import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockEnv: Record<string, string | undefined> = {};

vi.mock("@cap/env", () => ({
	serverEnv: vi.fn(() => mockEnv),
}));

import {
	resolveTranscriptionProvider,
	transcribeAudio,
	whisperSegmentsToWebVTT,
} from "@/lib/transcription";

describe("resolveTranscriptionProvider", () => {
	beforeEach(() => {
		mockEnv = {};
	});

	it("returns null when nothing is configured", () => {
		expect(resolveTranscriptionProvider()).toBeNull();
	});

	it("uses deepgram when only DEEPGRAM_API_KEY is set", () => {
		mockEnv = { DEEPGRAM_API_KEY: "dg-key" };
		expect(resolveTranscriptionProvider()).toBe("deepgram");
	});

	it("uses whisper when only WHISPER_API_URL is set", () => {
		mockEnv = { WHISPER_API_URL: "http://speaches:8000/v1" };
		expect(resolveTranscriptionProvider()).toBe("whisper");
	});

	it("uses whisper via Groq when only GROQ_API_KEY is set", () => {
		mockEnv = { GROQ_API_KEY: "groq-key" };
		expect(resolveTranscriptionProvider()).toBe("whisper");
	});

	it("uses whisper via OpenAI when only OPENAI_API_KEY is set", () => {
		mockEnv = { OPENAI_API_KEY: "sk-test" };
		expect(resolveTranscriptionProvider()).toBe("whisper");
	});

	it("prefers deepgram when both providers are configured", () => {
		mockEnv = { DEEPGRAM_API_KEY: "dg-key", GROQ_API_KEY: "groq-key" };
		expect(resolveTranscriptionProvider()).toBe("deepgram");
	});

	it("honors TRANSCRIPTION_PROVIDER override", () => {
		mockEnv = {
			DEEPGRAM_API_KEY: "dg-key",
			GROQ_API_KEY: "groq-key",
			TRANSCRIPTION_PROVIDER: "whisper",
		};
		expect(resolveTranscriptionProvider()).toBe("whisper");
	});

	it("returns null when the forced provider is not configured", () => {
		mockEnv = { GROQ_API_KEY: "groq-key", TRANSCRIPTION_PROVIDER: "deepgram" };
		expect(resolveTranscriptionProvider()).toBeNull();
	});
});

describe("whisperSegmentsToWebVTT", () => {
	it("formats segments as VTT cues", () => {
		const vtt = whisperSegmentsToWebVTT([
			{ text: " Hola, esto es Cap.", start: 0, end: 2.5 },
			{ text: "Segundo segmento.", start: 2.5, end: 4 },
		]);

		expect(vtt).toBe(
			"WEBVTT\n\n" +
				"1\n00:00:00.000 --> 00:00:02.500\nHola, esto es Cap.\n\n" +
				"2\n00:00:02.500 --> 00:00:04.000\nSegundo segmento.\n\n",
		);
	});

	it("skips empty segments", () => {
		const vtt = whisperSegmentsToWebVTT([
			{ text: "   ", start: 0, end: 1 },
			{ text: "Texto real.", start: 1, end: 2 },
		]);

		expect(vtt).toContain("1\n00:00:01.000 --> 00:00:02.000\nTexto real.");
		expect(vtt).not.toContain("00:00:00.000");
	});
});

describe("transcribeAudio with whisper", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		mockEnv = {
			WHISPER_API_URL: "http://speaches:8000/v1/",
			WHISPER_API_KEY: "local-key",
			WHISPER_MODEL: "whisper-large-v3-turbo",
		};
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("posts the audio to the OpenAI-compatible endpoint and returns VTT", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					text: "Hola mundo.",
					segments: [{ text: " Hola mundo.", start: 0, end: 1.2 }],
				}),
				{ status: 200 },
			),
		);

		const vtt = await transcribeAudio(Buffer.from("fake-audio"), "es");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://speaches:8000/v1/audio/transcriptions");
		expect(init.headers).toMatchObject({ authorization: "Bearer local-key" });

		const form = init.body as FormData;
		expect(form.get("model")).toBe("whisper-large-v3-turbo");
		expect(form.get("response_format")).toBe("verbose_json");
		expect(form.get("language")).toBe("es");

		expect(vtt).toContain("WEBVTT");
		expect(vtt).toContain("Hola mundo.");
	});

	it("defaults to whisper-1 against OpenAI when only OPENAI_API_KEY is set", async () => {
		mockEnv = { OPENAI_API_KEY: "sk-test" };
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ segments: [] }), { status: 200 }),
		);

		await transcribeAudio(Buffer.from("fake-audio"), "es");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect((init.body as FormData).get("model")).toBe("whisper-1");
	});

	it("omits the language field on auto-detect", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ segments: [] }), { status: 200 }),
		);

		await transcribeAudio(Buffer.from("fake-audio"), "auto");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.body as FormData).get("language")).toBeNull();
	});

	it("throws a descriptive error on non-200 responses", async () => {
		fetchMock.mockResolvedValue(
			new Response("model not found", { status: 404 }),
		);

		await expect(
			transcribeAudio(Buffer.from("fake-audio"), "es"),
		).rejects.toThrow(/Whisper transcription failed .*404/);
	});
});
