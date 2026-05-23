export type ServerStatus = "running" | "stopped" | "failed" | "unknown";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "manual_required";
export type BackupMode = "online" | "stop_then_backup";
export type ModpackProvider = "modrinth" | "curseforge";

export interface ManagedServer {
  id: string;
  name: string;
  directory: string;
  unitName: string;
  status: ServerStatus;
  port: number;
  memoryMb: number;
  javaArgs: string;
  modpackProvider?: ModpackProvider;
  modpackId?: string;
  modpackName?: string;
  rconEnabled: boolean;
  backupMode: BackupMode;
  backupCron: string;
  backupRetention: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServerSettingsInput {
  name: string;
  port: number;
  memoryMb: number;
  javaArgs: string;
  rconEnabled: boolean;
  backupMode: BackupMode;
  backupCron: string;
  backupRetention: number;
}

export interface BackupRecord {
  id: string;
  serverId: string;
  status: JobStatus;
  mode: BackupMode;
  path?: string;
  message?: string;
  createdAt: string;
  completedAt?: string;
}

export interface InstallJob {
  id: string;
  status: JobStatus;
  step: string;
  progress: number;
  message?: string;
  serverId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditableFile {
  key: string;
  label: string;
  relativePath: string;
  language: "properties" | "json" | "text";
}

export interface ModpackSearchResult {
  provider: ModpackProvider;
  id: string;
  name: string;
  summary: string;
  iconUrl?: string;
}

export interface ModpackVersion {
  provider: ModpackProvider;
  id: string;
  name: string;
  gameVersions: string[];
  loader: string[];
  hasServerDownload: boolean;
}

export interface CreateServerRequest {
  name: string;
  port: number;
  memoryMb: number;
  javaArgs: string;
  provider: ModpackProvider;
  modpackId: string;
  modpackName: string;
  versionId: string;
  acceptEula: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
  createdAt: string;
}

