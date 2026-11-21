export type TResearchGraphPoint = {
  label: string;
  value: number;
  unit: string;
  period: string;
  evidence_id: string;
};

export type TResearchGraph = {
  name: string;
  description: string;
  type: "bar" | "line";
  data: TResearchGraphPoint[];
};
