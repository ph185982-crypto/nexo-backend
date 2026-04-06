/**
 * Cloudinary upload helpers (server-side only).
 *
 * Uses the REST upload API — no extra SDK dependency.
 * Supports both signed (API_KEY + API_SECRET) and unsigned (UPLOAD_PRESET) modes.
 *
 * Required env vars (at least one combination):
 *   Signed:   CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 *   Unsigned: CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET
 */

import { createHash } from "crypto";

export interface CloudinaryResult {
  url: string;       // secure_url — always HTTPS
  publicId: string;  // public_id  — for future deletion/transforms
}

/**
 * Upload any file (image or video) to Cloudinary.
 * Returns the secure_url which is a public HTTPS CDN URL.
 * Throws on failure — never falls back to base64.
 */
export async function uploadToCloudinary(
  file: File,
  folder = "vendedoria/products"
): Promise<CloudinaryResult> {
  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey       = process.env.CLOUDINARY_API_KEY;
  const apiSecret    = process.env.CLOUDINARY_API_SECRET;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME não está configurado. " +
      "Acesse cloudinary.com → Dashboard → Cloud Name e adicione ao Render."
    );
  }

  const isVideo    = file.type.startsWith("video/");
  const resourceType = isVideo ? "video" : "image";

  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);

  if (apiKey && apiSecret) {
    // ── Signed upload (Cloudinary usa SHA-1 HMAC de params + api_secret) ─
    const timestamp = Math.round(Date.now() / 1000).toString();
    const paramsString = `folder=${folder}&timestamp=${timestamp}`;
    // Cloudinary signature: SHA1(sorted_params_string + api_secret) — NOT HMAC
    const sig = createHash("sha1").update(paramsString + apiSecret).digest("hex");

    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("signature", sig);
  } else if (uploadPreset) {
    // ── Unsigned upload (mais simples — requer preset configurado no Cloudinary) ──
    form.append("upload_preset", uploadPreset);
  } else {
    throw new Error(
      "Configure CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (recomendado) " +
      "ou CLOUDINARY_UPLOAD_PRESET no Render."
    );
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[Cloudinary] Upload failed:", errorText);
    throw new Error(`Cloudinary falhou (${res.status}): ${errorText}`);
  }

  const data = await res.json() as { secure_url: string; public_id: string };

  if (!data.secure_url) {
    throw new Error("Cloudinary não retornou secure_url");
  }

  return { url: data.secure_url, publicId: data.public_id };
}

/**
 * Upload a base64 data URI directly to Cloudinary.
 * Used for migrating existing products stored as base64 in the DB.
 */
export async function uploadBase64ToCloudinary(
  dataUri: string,
  folder = "vendedoria/products"
): Promise<CloudinaryResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET são obrigatórios");
  }

  // Determine resource type from MIME
  const mime = dataUri.split(";")[0].replace("data:", "");
  const resourceType = mime.startsWith("video/") ? "video" : "image";

  const timestamp = Math.round(Date.now() / 1000).toString();
  const paramsString = `folder=${folder}&timestamp=${timestamp}`;
  // Cloudinary signature: SHA1(sorted_params_string + api_secret) — NOT HMAC
  const sig = createHash("sha1").update(paramsString + apiSecret).digest("hex");

  const form = new FormData();
  form.append("file", dataUri);          // Cloudinary accepts data: URIs directly
  form.append("folder", folder);
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", sig);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloudinary upload failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { secure_url: string; public_id: string };
  if (!data.secure_url) throw new Error("Cloudinary não retornou secure_url");
  return { url: data.secure_url, publicId: data.public_id };
}

/** Returns true if Cloudinary is configured (at least cloud name + one auth method). */
export function isCloudinaryConfigured(): boolean {
  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const hasSignedKey = !!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  const hasPreset    = !!process.env.CLOUDINARY_UPLOAD_PRESET;
  return !!(cloudName && (hasSignedKey || hasPreset));
}
