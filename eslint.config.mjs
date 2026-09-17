import nextConfig from "eslint-config-next";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: ["node_modules/**", ".next/**", "src/generated/**", "prototype/**", "docs/**", "next-env.d.ts"] },
  ...nextConfig,
  ...nextTs,
];

export default config;
