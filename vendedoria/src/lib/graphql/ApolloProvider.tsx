"use client";

import { ApolloProvider as BaseProvider } from "@apollo/client";
import { apolloClient } from "./client";

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  return <BaseProvider client={apolloClient}>{children}</BaseProvider>;
}
