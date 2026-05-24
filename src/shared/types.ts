export type ServerStatus = "running" | "stopped" | "failed" | "unknown";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "manual_required";
export type BackupMode = "online" | "stop_then_backup";
export type ModpackProvider = "modrinth" | "curseforge";
export type DiscoveryConfidence = "high" | "medium" | "low" | "unmatched";
export type ServerActionKind = "backup" | "restart" | "start" | "stop" | "custom";
export type ExternalScheduleKind = "backup" | "restart" | "unknown";
export type JavaArgsSourceType = "user_jvm_args" | "script" | "systemd" | "default";

export interface ManagedServer {
  id: string;
  name: string;
  directory: string;
  unitName: string;
  status: ServerStatus;
  port: number;
  memoryMb: number;
  javaArgs: string;
  javaArgsSourceType: JavaArgsSourceType;
  javaArgsSourcePath?: string;
  javaArgsEditable: boolean;
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
  unitName: string;
  port: number;
  memoryMb: number;
  javaArgs: string;
  javaArgsSourceType: JavaArgsSourceType;
  javaArgsSourcePath?: string;
  javaArgsEditable: boolean;
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

export interface ServerLogFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface ServerLogContent extends ServerLogFile {
  content: string;
  truncated: boolean;
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

export interface DiscoveredScript {
  id: string;
  name: string;
  kind: ServerActionKind;
  path: string;
  safe: boolean;
  reason?: string;
}

export interface ExternalSchedule {
  id: string;
  serverId?: string;
  kind: ExternalScheduleKind;
  expression: string;
  command: string;
  source: string;
  readOnly: boolean;
  createdAt?: string;
}

export interface ImportPreviewItem {
  id: string;
  name: string;
  directory: string;
  unitName: string;
  unitMatchSource: string;
  confidence: DiscoveryConfidence;
  port: number;
  memoryMb: number;
  javaArgs: string;
  javaArgsSourceType: JavaArgsSourceType;
  javaArgsSourcePath?: string;
  javaArgsEditable: boolean;
  alreadyImported: boolean;
  scripts: DiscoveredScript[];
  externalSchedules: ExternalSchedule[];
  warnings: string[];
}

export interface ImportPreview {
  serverRoot: string;
  items: ImportPreviewItem[];
  unmatchedServices: Array<{ unitName: string; description?: string; matchedText?: string }>;
}

export interface ServerAction {
  id: string;
  serverId: string;
  name: string;
  kind: ServerActionKind;
  scriptPath: string;
  createdAt: string;
}

export interface ServiceTestResult {
  existsLikely: boolean;
  status: "active" | "inactive" | "failed" | "unknown" | "not-found";
  message: string;
}

export interface ImportSelection {
  id: string;
  unitName?: string;
}

export interface JavaArgsDiscovery {
  javaArgs: string;
  sourceType: JavaArgsSourceType;
  sourcePath?: string;
  editable: boolean;
  memoryMb?: number;
}
