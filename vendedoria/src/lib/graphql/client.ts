"use client";

import { ApolloClient, InMemoryCache, createHttpLink, split } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";

const httpLink = createHttpLink({
  uri: "/api/graphql",
  credentials: "same-origin",
});

function makeWsLink() {
  if (typeof window === "undefined") return null;
  return new GraphQLWsLink(
    createClient({
      url: `${window.location.origin.replace("http", "ws")}/api/graphql`,
    })
  );
}

function makeLink() {
  const wsLink = makeWsLink();
  if (!wsLink) return httpLink;

  return split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === "OperationDefinition" &&
        definition.operation === "subscription"
      );
    },
    wsLink,
    httpLink
  );
}

export const apolloClient = new ApolloClient({
  link: makeLink(),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          getConversationsByWhatsappAccount: {
            keyArgs: ["accountId", "filters"],
            merge(existing, incoming) {
              const existingConvs = existing?.conversations ?? [];
              return {
                ...incoming,
                conversations: [...existingConvs, ...incoming.conversations],
              };
            },
          },
          getConversationMessages: {
            keyArgs: ["conversationId"],
            merge(existing, incoming) {
              const existingMsgs = existing?.messages ?? [];
              return {
                ...incoming,
                messages: [...incoming.messages, ...existingMsgs],
              };
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: { fetchPolicy: "cache-and-network" },
  },
});
