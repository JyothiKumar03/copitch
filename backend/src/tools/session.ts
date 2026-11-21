import { tool } from "ai";
import { z } from "zod";
import type { TToolProviders } from "../types/ai";

export const session_tools = (context: string): TToolProviders => {
  return {
    session: {
      read_context: tool({
        description: "Read up to 4,000 characters of this session's supplied material, starting at a character offset.",
        inputSchema: z.object({ offset: z.number().int().min(0).max(60000) }),
        execute: async ({ offset }) => ({
          excerpt: context.slice(offset, offset + 4000),
          remaining: Math.max(0, context.length - offset - 4000),
        }),
      }),
      find_context: tool({
        description: "Find a literal phrase in this session's supplied material. Returns the first matching offset or null.",
        inputSchema: z.object({ phrase: z.string().trim().min(1).max(256) }),
        execute: async ({ phrase }) => {
          const offset = context.indexOf(phrase);
          return { offset: offset < 0 ? null : offset };
        },
      }),
    },
  };
};
