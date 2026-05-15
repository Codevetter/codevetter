import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = "https://codevetter.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/download`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];
}
