import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	resolveTranscriptionProvider,
	transcribeAudio,
} from "@/lib/transcription";

// Live smoke test against a real Whisper endpoint (OpenAI, Groq, or a local
// server). Skipped unless explicitly enabled:
//   WHISPER_LIVE_AUDIO=/path/to/audio.mp3 pnpm exec vitest run __tests__/integration/whisper-live.test.ts
// with OPENAI_API_KEY / GROQ_API_KEY / WHISPER_API_URL present in the env.
const audioPath = process.env.WHISPER_LIVE_AUDIO;

describe.skipIf(!audioPath)("whisper live transcription", () => {
	it("transcribes real audio into VTT", async () => {
		expect(resolveTranscriptionProvider()).toBe("whisper");

		const audio = await readFile(audioPath as string);
		const vtt = await transcribeAudio(audio, "auto");

		console.log(`[whisper-live] VTT output:\n${vtt}`);

		expect(vtt.startsWith("WEBVTT")).toBe(true);
		expect(vtt).toMatch(
			/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/,
		);
	}, 120_000);
});
