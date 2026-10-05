/** @type {import('next').NextConfig} */
const nextConfig = {
  // пакет-движок — часть монорепозитория (npm workspaces), транспилируем как обычный исходник
  transpilePackages: ["@stroykroy/pattern-engine"],
};

module.exports = nextConfig;
