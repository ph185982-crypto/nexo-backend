import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listProfiles, createProfile } from "@/lib/finance/repository";

export async function GET(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  const profiles = await listProfiles(organizationId);
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as { organizationId?: string; name?: string; personType?: string; cpfCnpj?: string };
  if (!body.organizationId || !body.name || !body.personType) {
    return NextResponse.json({ error: "organizationId, name, personType required" }, { status: 400 });
  }
  if (!["PESSOA_FISICA", "PESSOA_JURIDICA"].includes(body.personType)) {
    return NextResponse.json({ error: "personType must be PESSOA_FISICA or PESSOA_JURIDICA" }, { status: 400 });
  }
  const profile = await createProfile(body.organizationId, {
    name: body.name,
    personType: body.personType as "PESSOA_FISICA" | "PESSOA_JURIDICA",
    cpfCnpj: body.cpfCnpj,
  });
  return NextResponse.json(profile, { status: 201 });
}
