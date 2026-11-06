import { AsyncLocalStorage } from "node:async_hooks";

export type User = { id: number; username: string; role: "admin" | "user" };

// Request identity must follow asynchronous work, never a mutable global user ID.
export function createUserContext() {
  const context = new AsyncLocalStorage<User>();
  const owner: User = { id: 1, username: "admin", role: "admin" };
  return {
    current: () => context.getStore() ?? owner,
    run: <T>(user: User, action: () => T): T => context.run(user, action),
  };
}
