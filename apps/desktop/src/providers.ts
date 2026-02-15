import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ChatMessage, ProviderConfig } from "./types";

export function createLanguageModel(config: ProviderConfig, model?: string) {
  const modelId = model ?? config.defaultModel;

  switch (config.type) {
    case "openai":
    case "ollama": {
      const openai = createOpenAI({
        apiKey: config.apiKey ?? "ollama",
        baseURL: config.baseUrl,
      });
      return openai(modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey ?? "",
        baseURL: config.baseUrl,
      });
      return anthropic(modelId);
    }
  }
}

export async function streamChatResponse(
  config: ProviderConfig,
  messages: ChatMessage[],
  model?: string,
  onTextDelta?: (delta: string, accumulated: string) => void,
): Promise<string> {
  const languageModel = createLanguageModel(config, model);

  const result = streamText({
    model: languageModel,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  let accumulated = "";
  const stream = result.textStream;
  for await (const delta of stream) {
    accumulated += delta;
    onTextDelta?.(delta, accumulated);
  }

  return accumulated;
}
