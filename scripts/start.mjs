import { configureEnvironment } from "./environment.mjs";

process.env.NODE_ENV ||= "production";
configureEnvironment();
process.env.HOSTNAME ||= "127.0.0.1";
await import(new URL("../.next/standalone/server.js", import.meta.url));
