/**
 * Audio transcription via OpenAI Whisper (whisper-1).
 *
 * WhatsApp sends voice/audio messages as OGG (Opus codec).
 * Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg.
 *
 * Falls back gracefully when OPENAI_API_KEY is absent —
 * the caller receives null and can display a humanized label instead.
 */

/** Map from WhatsApp mime_type to a safe file extension for Whisper. */
function mimeToExtension(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "ogg"; // WhatsApp default
}

/**
 * Transcribes an audio buffer using OpenAI Whisper.
 *
 * @param audioBuffer  Raw audio bytes downloaded from WhatsApp.
 * @param mimeType     The mime_type field from the WhatsApp audio payload (e.g. "audio/ogg; codecs=opus").
 * @returns Transcribed text, or null if the API is unavailable or fails.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg"
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Transcription] OPENAI_API_KEY not configured — skipping transcription");
    return null;
  }

  try {
    const extension = mimeToExtension(mimeType);
    const blob = new Blob([audioBuffer], { type: mimeType.split(";")[0].trim() });

    const formData = new FormData();
    formData.append("file", blob, `audio.${extension}`);
    formData.append("model", "whisper-1");
    // Hint the language to improve accuracy on Portuguese audio
    formData.append("language", "pt");
    formData.append("response_format", "text");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!response.ok) {
      console.error("[Transcription] Whisper API error:", await response.text());
      return null;
    }

    // response_format=text returns plain text, not JSON
    const text = await response.text();
    return text.trim() || null;
  } catch (err) {
    console.error("[Transcription] Unexpected error:", err);
    return null;
  }
}
