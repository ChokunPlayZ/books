import nextEnv from "@next/env";

export function configureEnvironment() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
}
