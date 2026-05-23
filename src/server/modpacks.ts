import type { ModpackSearchResult, ModpackVersion } from "../shared/types.js";

export async function searchModpacks(query: string): Promise<ModpackSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results = await Promise.allSettled([searchModrinth(trimmed), searchCurseForgePlaceholder(trimmed)]);
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function getVersions(provider: string, id: string): Promise<ModpackVersion[]> {
  if (provider === "modrinth") return modrinthVersions(id);
  if (provider === "curseforge") return curseForgeManualVersions(id);
  throw new Error("Unsupported modpack provider.");
}

async function searchModrinth(query: string): Promise<ModpackSearchResult[]> {
  const url = new URL("https://api.modrinth.com/v2/search");
  url.searchParams.set("query", query);
  url.searchParams.set("facets", JSON.stringify([["project_type:modpack"]]));
  url.searchParams.set("limit", "10");
  const response = await fetch(url, { headers: { "User-Agent": "mc-server-configurator/0.1" } });
  if (!response.ok) throw new Error("Modrinth search failed.");
  const data = await response.json() as { hits: Array<{ project_id: string; title: string; description: string; icon_url?: string }> };
  return data.hits.map((hit) => ({
    provider: "modrinth",
    id: hit.project_id,
    name: hit.title,
    summary: hit.description,
    iconUrl: hit.icon_url
  }));
}

async function modrinthVersions(id: string): Promise<ModpackVersion[]> {
  const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version`, {
    headers: { "User-Agent": "mc-server-configurator/0.1" }
  });
  if (!response.ok) throw new Error("Modrinth versions failed.");
  const data = await response.json() as Array<{
    id: string;
    name: string;
    game_versions: string[];
    loaders: string[];
    files: Array<{ primary: boolean; url: string }>;
  }>;
  return data.map((version) => ({
    provider: "modrinth",
    id: version.id,
    name: version.name,
    gameVersions: version.game_versions,
    loader: version.loaders,
    hasServerDownload: version.files.some((file) => file.primary && file.url.endsWith(".mrpack"))
  }));
}

async function searchCurseForgePlaceholder(query: string): Promise<ModpackSearchResult[]> {
  return [
    {
      provider: "curseforge",
      id: `manual-${query.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: `CurseForge manual install: ${query}`,
      summary: "CurseForge API access requires an API key. This entry creates a manual-upload-required install job."
    }
  ];
}

async function curseForgeManualVersions(id: string): Promise<ModpackVersion[]> {
  return [
    {
      provider: "curseforge",
      id: `${id}-manual`,
      name: "Manual server pack upload required",
      gameVersions: [],
      loader: [],
      hasServerDownload: false
    }
  ];
}

