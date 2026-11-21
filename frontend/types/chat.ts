export type TChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TChatRequest = {
  message: string;
  history: TChatMessage[];
};

export type TChatResponse = {
  reply: string;
};
