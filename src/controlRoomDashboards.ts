import { normalizeControlRoomCustomUrl } from "./controlRoomState";

export type DashboardCredentialMode = "none" | "form" | "access-key" | "basic";

export type SavedDashboard = {
  id: string;
  name: string;
  url: string;
  credentialMode: DashboardCredentialMode;
  hasCredentials: boolean;
  autoSubmit: boolean;
};

export type SavedDashboardDraft = {
  id: string;
  name: string;
  url: string;
  credentialMode: DashboardCredentialMode;
  username: string;
  password: string;
  autoSubmit: boolean;
};

export const emptySavedDashboardDraft: SavedDashboardDraft = {
  id: "",
  name: "",
  url: "https://",
  credentialMode: "none",
  username: "",
  password: "",
  autoSubmit: true
};

export function normalizeSavedDashboards(value: unknown): SavedDashboard[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const url = typeof item.url === "string" ? normalizeControlRoomCustomUrl(item.url) : "";
    const credentialMode: DashboardCredentialMode = item.credentialMode === "form" || item.credentialMode === "access-key" || item.credentialMode === "basic"
      ? item.credentialMode
      : "none";
    if (!id || !name || !url || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      url,
      credentialMode,
      hasCredentials: credentialMode !== "none" && item.hasCredentials === true,
      autoSubmit: (credentialMode === "form" || credentialMode === "access-key") && item.autoSubmit !== false
    }];
  });
}
