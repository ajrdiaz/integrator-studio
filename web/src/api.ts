import type { JobManifest } from "../../src/jobs/store";
import type { Format, Storyboard } from "../../src/schemas/storyboard";
import type { Timeline } from "../../src/schemas/timeline";

export type Runtime = "idle" | "queued" | "running" | "done" | "error";
export interface JobSummary extends JobManifest {
  runtime: Runtime;
  title?: string;
}
export interface JobView {
  manifest: JobManifest;
  runtime: Runtime;
  storyboard: Storyboard | null;
  timeline: Timeline | null;
  history: number[];
}
export interface RunBody {
  formats?: Format[];
  from?: string;
  until?: string;
  tts?: string | false;
  draft?: boolean;
}
export interface RunEvent {
  t: string;
  type: "progress" | "status";
  stage?: string;
  message: string;
  status?: Runtime;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error ?? `Error ${res.status}`) as Error & { details?: string[] };
    err.details = (data as { errors?: string[] }).errors;
    throw err;
  }
  return data as T;
}

export const api = {
  list: () => call<JobSummary[]>("/api/jobs"),
  create: (request: string) => call<{ id: string }>("/api/jobs", { method: "POST", body: JSON.stringify({ request }) }),
  get: (id: string) => call<JobView>(`/api/jobs/${id}`),
  saveStoryboard: (id: string, storyboard: unknown) =>
    call<JobView>(`/api/jobs/${id}/storyboard`, { method: "PUT", body: JSON.stringify({ storyboard }) }),
  review: (id: string) => call<JobView>(`/api/jobs/${id}/review`, { method: "POST" }),
  reviewVisual: (id: string) => call<JobView>(`/api/jobs/${id}/review/visual`, { method: "POST" }),
  history: (id: string, v: number) => call<Storyboard>(`/api/jobs/${id}/history/${v}`),
  run: (id: string, body: RunBody) => call<{ status: Runtime }>(`/api/jobs/${id}/run`, { method: "POST", body: JSON.stringify(body) }),
  sceneVoice: (id: string, scene: string, body: RunBody) =>
    call<{ status: Runtime }>(`/api/jobs/${id}/scenes/${scene}/voice`, { method: "POST", body: JSON.stringify(body) }),
  events: (id: string, onEvent: (e: RunEvent) => void) => {
    const es = new EventSource(`/api/jobs/${id}/events`);
    es.onmessage = (m) => onEvent(JSON.parse(m.data) as RunEvent);
    return () => es.close();
  },
};
