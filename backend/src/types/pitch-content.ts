export type TPitchPassage = {
  purpose: "opening" | "point" | "close";
  prose: string;
  support: { evidence_id: string; excerpt: string }[];
};

export type TPitchContent = {
  title: string;
  format: "script" | "talking_points";
  passages: { label: string; text: string; evidence_ids: string[] }[];
  sources: { id: string; location: string; url?: string }[];
  gaps: string[];
};
