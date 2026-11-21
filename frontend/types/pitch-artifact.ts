export type TPitchChartPoint = {
  label: string;
  value: number | null;
  unit: string;
  evidence_id: string;
  numerator?: number;
  denominator?: number;
};

export type TPitchChart = {
  name: string;
  description: string;
  type: "bar" | "line";
  data: TPitchChartPoint[];
};
