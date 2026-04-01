import { NextRequest, NextResponse } from "next/server";

// Direct upload to Cloudinary using unsigned preset.
// Set env vars: CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET (unsigned preset)
export async function POST(req: NextRequest) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    return NextResponse.json(
      { error: "CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET env vars are required" },
      { status: 503 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Forward to Cloudinary
  const cloudForm = new FormData();
  cloudForm.append("file", file);
  cloudForm.append("upload_preset", uploadPreset);
  cloudForm.append("folder", "vendedoria/products");

  const resourceType = file.type.startsWith("video/") ? "video" : "image";
  const cloudRes = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: "POST", body: cloudForm }
  );

  if (!cloudRes.ok) {
    const err = await cloudRes.text();
    console.error("[Upload] Cloudinary error:", err);
    return NextResponse.json({ error: "Upload failed", detail: err }, { status: 502 });
  }

  const data = await cloudRes.json() as { secure_url: string; public_id: string };
  return NextResponse.json({ url: data.secure_url, publicId: data.public_id });
}
