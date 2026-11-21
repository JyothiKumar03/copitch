"use client";

import { useMutation } from "@tanstack/react-query";
import { sendMessage } from "@/lib/api";

export const useSendMessage = () => {
  return useMutation({ mutationFn: sendMessage, retry: false });
};
