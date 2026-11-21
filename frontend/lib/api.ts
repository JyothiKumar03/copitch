import type { TChatRequest, TChatResponse } from "@/types/chat";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function sendMessage({ message, history }: TChatRequest): Promise<string> {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }

  const data: Partial<TChatResponse> | null = await response.json();
  if (typeof data?.reply !== "string" || !data.reply) {
    throw new Error("Empty reply from API");
  }

  return data.reply;
}
