const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Retrieves the temporary CDN URL for a WhatsApp media object.
 * The returned URL is valid for ~5 minutes.
 */
export async function getMediaUrl(
  mediaId: string,
  accessToken: string
): Promise<string> {
  const response = await fetch(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`[WhatsApp Media] Failed to get URL for ${mediaId}: ${await response.text()}`);
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error(`[WhatsApp Media] No URL in response for ${mediaId}`);
  return data.url;
}

/**
 * Downloads raw media bytes from a WhatsApp CDN URL.
 * Requires the same access token used to obtain the URL.
 */
export async function downloadMedia(
  url: string,
  accessToken: string
): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`[WhatsApp Media] Failed to download media: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
