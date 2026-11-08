import { AsyncLocalStorage } from "node:async_hooks";

// Background work cooperates at network boundaries; an in-flight response is
// allowed to finish. This also covers requests made by nested source adapters.
type Runtime = {
  checkpoint(): Promise<void>;
  request<T>(url: string, load: () => Promise<T>): Promise<T>;
  minimumDelay(milliseconds: number): void;
};
const runtime = new AsyncLocalStorage<Runtime>();
export class ScrapeInterrupted extends Error {}
export const withScrapeRuntime = <T>(value: Runtime, load: () => T) =>
  runtime.run(value, load);
export const scrapeCheckpoint = async () => runtime.getStore()?.checkpoint();
export const isBackgroundScrape = () => !!runtime.getStore();
export const minimumScrapeDelay = (milliseconds: number) =>
  runtime.getStore()?.minimumDelay(milliseconds);
export const backgroundRequest = <T>(url: string, load: () => Promise<T>) =>
  runtime.getStore()?.request(url, load) ?? load();
