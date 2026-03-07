export type AutoBuyProvider = "oss" | "cloud";

export const getAutoBuyProvider = (): AutoBuyProvider => {
  const rawValue = (import.meta.env.VITE_AUTOBUY_PROVIDER ?? import.meta.env.AUTOBUY_PROVIDER ?? "oss")
    .toString()
    .trim()
    .toLowerCase();

  if (rawValue === "cloud") return "cloud";
  return "oss";
};

export const getOssRunnerUrl = (): string => {
  return (import.meta.env.VITE_OSS_RUNNER_URL ?? "http://localhost:8081").toString().trim();
};
