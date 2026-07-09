import { prisma } from "@/lib/prisma/client";
import { chatCompletion } from "./openai";
import { buildMaxSystemPrompt } from "./prompt";
import { MAX_TOOLS } from "./tools/definitions";
import { executeMaxTool } from "./tools/executors";
import { MAX_CHAT_MODEL, MAX_TOOL_ITERATIONS, MAX_OWNER_NUMBER } from "./config";

export async function runMaxAgent(
  userContent: string | Array<{ type: string; [k: string]: unknown }>,
): Promise<string> {
  const systemPrompt = await buildMaxSystemPrompt();

  // Load recent conversation history
  const history = await prisma.conversaMax.findMany({
    where: { numero: MAX_OWNER_NUMBER },
    orderBy: { criado_em: "desc" },
    take: 20,
    select: { role: true, content: true },
  });

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: systemPrompt },
  ];

  // Add history in chronological order
  for (const h of history.reverse()) {
    messages.push({ role: h.role, content: h.content });
  }

  // Add current user message
  messages.push({ role: "user", content: userContent });

  // Persist user message
  const userText = typeof userContent === "string" ? userContent : JSON.stringify(userContent);
  await prisma.conversaMax.create({
    data: { numero: MAX_OWNER_NUMBER, role: "user", content: userText },
  });

  let finalResponse = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await chatCompletion({
      model: MAX_CHAT_MODEL,
      messages,
      tools: MAX_TOOLS,
    });

    const choice = result.choices[0]?.message;
    if (!choice) break;

    // If model returns text content (no tool calls), we're done
    if (!choice.tool_calls?.length) {
      finalResponse = choice.content ?? "";
      break;
    }

    // Model wants to call tools
    messages.push({
      role: "assistant",
      content: choice.content,
      ...({ tool_calls: choice.tool_calls } as Record<string, unknown>),
    });

    // Execute each tool call
    for (const tc of choice.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch { /* empty args */ }

      console.log(`[Max] Tool call: ${tc.function.name}(${JSON.stringify(args).slice(0, 200)})`);
      const toolResult = await executeMaxTool(tc.function.name, args);

      messages.push({
        role: "tool",
        content: toolResult,
        ...({ tool_call_id: tc.id } as Record<string, unknown>),
      });
    }

    // If content was provided alongside tool_calls, capture it
    if (choice.content) finalResponse = choice.content;
  }

  // If we exhausted iterations without a final text response, do one more call without tools
  if (!finalResponse) {
    const summaryResult = await chatCompletion({
      model: MAX_CHAT_MODEL,
      messages: [...messages, { role: "user", content: "Resuma o que foi feito." }],
    });
    finalResponse = summaryResult.choices[0]?.message?.content ?? "Pronto, tudo feito!";
  }

  // Persist assistant response
  await prisma.conversaMax.create({
    data: { numero: MAX_OWNER_NUMBER, role: "assistant", content: finalResponse },
  });

  return finalResponse;
}
