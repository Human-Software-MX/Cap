import { serverEnv } from "@cap/env";
import {
	AI_GENERATION_LANGUAGE_AUTO,
	type AiGenerationLanguage,
	type AiGenerationLanguageCode,
} from "@cap/web-domain";
import { createClient } from "@deepgram/sdk";
import {
	type DeepgramResult,
	formatTimestamp,
	formatToWebVTT,
} from "@/lib/transcribe-utils";

export type TranscriptionProvider = "deepgram" | "whisper";

const DEFAULT_WHISPER_MODEL = "whisper-large-v3-turbo";
const DEFAULT_OPENAI_WHISPER_MODEL = "whisper-1";
const GROQ_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface WhisperConfig {
	baseUrl: string;
	apiKey?: string;
	model: string;
}

// An explicit WHISPER_API_URL wins; otherwise a configured GROQ_API_KEY or
// OPENAI_API_KEY is enough because both serve Whisper through the same
// OpenAI-compatible API (Groq preferred — cheaper and faster).
function resolveWhisperConfig(
	env: ReturnType<typeof serverEnv>,
): WhisperConfig | null {
	if (env.WHISPER_API_URL) {
		return {
			baseUrl: env.WHISPER_API_URL.replace(/\/$/, ""),
			apiKey: env.WHISPER_API_KEY ?? env.GROQ_API_KEY,
			model: env.WHISPER_MODEL ?? DEFAULT_WHISPER_MODEL,
		};
	}

	if (env.GROQ_API_KEY) {
		return {
			baseUrl: GROQ_OPENAI_BASE_URL,
			apiKey: env.GROQ_API_KEY,
			model: env.WHISPER_MODEL ?? DEFAULT_WHISPER_MODEL,
		};
	}

	if (env.OPENAI_API_KEY) {
		return {
			baseUrl: OPENAI_BASE_URL,
			apiKey: env.OPENAI_API_KEY,
			model: env.WHISPER_MODEL ?? DEFAULT_OPENAI_WHISPER_MODEL,
		};
	}

	return null;
}

export function resolveTranscriptionProvider(): TranscriptionProvider | null {
	const env = serverEnv();
	const deepgramAvailable = Boolean(env.DEEPGRAM_API_KEY);
	const whisperAvailable = resolveWhisperConfig(env) !== null;

	if (env.TRANSCRIPTION_PROVIDER === "deepgram")
		return deepgramAvailable ? "deepgram" : null;
	if (env.TRANSCRIPTION_PROVIDER === "whisper")
		return whisperAvailable ? "whisper" : null;

	if (deepgramAvailable) return "deepgram";
	if (whisperAvailable) return "whisper";
	return null;
}

export function isTranscriptionConfigured(): boolean {
	return resolveTranscriptionProvider() !== null;
}

export async function transcribeAudio(
	audioBuffer: Buffer,
	language: AiGenerationLanguage,
): Promise<string> {
	const provider = resolveTranscriptionProvider();

	switch (provider) {
		case "deepgram":
			return transcribeWithDeepgram(audioBuffer, language);
		case "whisper":
			return transcribeWithWhisper(audioBuffer, language);
		default:
			throw new Error("No transcription provider configured");
	}
}

export function getDeepgramTranscriptionOptions(
	language: AiGenerationLanguage,
) {
	const baseOptions = {
		model: "nova-3",
		smart_format: true,
		utterances: true,
		mime_type: "audio/mpeg",
	} as const;

	if (language === AI_GENERATION_LANGUAGE_AUTO) {
		return {
			...baseOptions,
			detect_language: [...DEEPGRAM_DETECTABLE_LANGUAGES],
		};
	}

	return {
		...baseOptions,
		language,
	};
}

async function transcribeWithDeepgram(
	audioBuffer: Buffer,
	language: AiGenerationLanguage,
): Promise<string> {
	const deepgram = createClient(serverEnv().DEEPGRAM_API_KEY as string);

	const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
		audioBuffer,
		getDeepgramTranscriptionOptions(language),
	);

	if (error) {
		throw new Error(
			`Deepgram transcription failed (language=${language}): ${error.message}`,
		);
	}

	return formatToWebVTT(result as unknown as DeepgramResult);
}

export interface WhisperSegment {
	text: string;
	start: number;
	end: number;
}

interface WhisperVerboseResponse {
	text?: string;
	segments?: WhisperSegment[];
}

async function transcribeWithWhisper(
	audioBuffer: Buffer,
	language: AiGenerationLanguage,
): Promise<string> {
	const config = resolveWhisperConfig(serverEnv());
	if (!config) throw new Error("Whisper transcription is not configured");

	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" }),
		"audio.mp3",
	);
	form.append("model", config.model);
	form.append("response_format", "verbose_json");
	if (language !== AI_GENERATION_LANGUAGE_AUTO)
		form.append("language", language);

	const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
		method: "POST",
		headers: config.apiKey
			? { authorization: `Bearer ${config.apiKey}` }
			: undefined,
		body: form,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Whisper transcription failed (language=${language}): ${response.status} ${detail.slice(0, 300)}`,
		);
	}

	const result = (await response.json()) as WhisperVerboseResponse;
	return whisperSegmentsToWebVTT(result.segments ?? []);
}

export function whisperSegmentsToWebVTT(segments: WhisperSegment[]): string {
	let output = "WEBVTT\n\n";
	let captionIndex = 1;

	for (const segment of segments) {
		const text = segment.text.trim();
		if (!text) continue;

		const start = formatTimestamp(segment.start);
		const end = formatTimestamp(segment.end);
		output += `${captionIndex}\n${start} --> ${end}\n${text}\n\n`;
		captionIndex++;
	}

	return output;
}

const DEEPGRAM_DETECTABLE_LANGUAGES = [
	"en",
	"es",
	"fr",
	"de",
	"pt",
	"it",
	"nl",
	"pl",
	"sk",
	"ru",
	"tr",
	"ja",
	"ko",
	"zh",
	"hi",
] as const satisfies readonly AiGenerationLanguageCode[];
