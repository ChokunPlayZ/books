export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type ScrapeJob = {
  id: string;
  kind: string;
  label: string;
  userId: number;
  username: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string;
};
export type QueueQuery = {
  status?: JobStatus | "all";
  search?: string;
  page?: number;
};
export type QueueOverview = {
  paused: boolean;
  concurrency: number;
  counts: Record<JobStatus, number>;
  jobs: ScrapeJob[];
  total: number;
  page: number;
  pages: number;
};
export type JobDetail = ScrapeJob & {
  payload: unknown;
  result: unknown;
  eventPage: number;
  eventPages: number;
  events: {
    id: number;
    createdAt: number;
    message: string;
    actor: string | null;
  }[];
};
