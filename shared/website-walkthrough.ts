export const WEBSITE_WALKTHROUGH_DEPTHS = [0, 1, 2, 3] as const;
export const DEFAULT_WEBSITE_WALKTHROUGH_DEPTH = 2;
export const MAX_WEBSITE_WALKTHROUGH_PAGES = 5;

export type TWebsiteWalkthroughInput = {
  request_id: string;
  url: string;
  audience: string;
  goal: string;
  max_depth: number;
  approved: true;
};

export type TWebsiteCaptureAttempt = {
  url: string;
  status: "captured" | "failed";
  observed_url?: string;
  depth?: number;
  reason?: string;
};

export type TWebsiteWalkthroughPage = {
  capture_id: number;
  url: string;
  title: string;
  facts: string[];
  depth?: number;
};

export type TWebsiteWalkthrough = Omit<TWebsiteWalkthroughInput, "request_id" | "approved"> & {
  walkthrough_id: string;
  created_at: number;
  status: "queued" | "capturing" | "exporting" | "completed" | "failed";
  pages: TWebsiteWalkthroughPage[];
  attempts: TWebsiteCaptureAttempt[];
  error?: string;
};
