import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { typeDefs } from "@/graphql/schema/typeDefs";
import { resolvers } from "@/graphql/resolvers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma/client";
import type { NextRequest } from "next/server";

export interface GraphQLContext {
  userId?: string;
  userRole?: string;
  /** IDs of organizations this user is allowed to access */
  allowedOrgIds: string[];
}

const server = new ApolloServer<GraphQLContext>({
  typeDefs,
  resolvers,
  introspection: process.env.NODE_ENV !== "production",
});

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(server, {
  context: async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return { allowedOrgIds: [] };
    }

    // For a single-user internal tool, every org in the DB belongs to the owner.
    // We still fetch them so the check works if more orgs are added.
    const orgs = await prisma.whatsappBusinessOrganization.findMany({
      select: { id: true },
    });

    return {
      userId: session.user.id,
      userRole: (session.user as { role?: string }).role,
      allowedOrgIds: orgs.map((o) => o.id),
    };
  },
});

// Next.js 15 requires route handlers to accept (req, ctx) — wrap to satisfy the type
export async function GET(req: NextRequest) {
  return handler(req);
}
export async function POST(req: NextRequest) {
  return handler(req);
}
