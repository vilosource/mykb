import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  Workspace,
  WorkspaceState,
  WorkspaceLinks,
  WorkspaceDocument,
  WorkspaceStorage,
  CreateWorkspaceOptions,
  JournalEntry,
  AddArtifactOptions,
  ArtifactEntry,
  ArtifactSyncResult,
} from './types.js';
import { WorkspaceNotFoundError } from './errors.js';

export class FileSystemWorkspaceStorage implements WorkspaceStorage {
  private readonly workspacesDir: string;

  constructor(private readonly brainPath: string) {
    this.workspacesDir = path.join(brainPath, 'workspaces');
  }

  private workspaceDir(id: string): string {
    return path.join(this.workspacesDir, id);
  }

  private workspaceFile(id: string): string {
    return path.join(this.workspaceDir(id), 'workspace.json');
  }

  private activeFile(): string {
    return path.join(this.workspacesDir, '.active');
  }

  private sessionFile(): string | null {
    const sessionId = process.env.KB_SESSION_ID?.trim();
    if (!sessionId) return null;
    return path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
  }

  private archiveDir(id: string): string {
    return path.join(this.workspacesDir, 'archive', id);
  }

  private journalFile(id: string): string {
    return path.join(this.workspaceDir(id), 'journal.jsonl');
  }

  private ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  private readWorkspaceFile(id: string): Workspace | null {
    const file = this.workspaceFile(id);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;

    // Backward compat: migrate documents → artifacts
    if (!('artifacts' in raw)) {
      raw.artifacts = [];
      delete raw.documents;
    }

    return raw as unknown as Workspace;
  }

  private writeWorkspaceFile(id: string, ws: Workspace): void {
    fs.writeFileSync(this.workspaceFile(id), JSON.stringify(ws, null, 2) + '\n');
  }

  private requireWorkspace(id: string): Workspace {
    const ws = this.readWorkspaceFile(id);
    if (!ws) throw new WorkspaceNotFoundError(`Workspace not found: ${id}`);
    return ws;
  }

  createWorkspace(id: string, name: string, options?: CreateWorkspaceOptions): void {
    const dir = this.workspaceDir(id);
    this.ensureDir(dir);

    const now = new Date().toISOString();
    const ws: Workspace = {
      id,
      name,
      state: {},
      areas: options?.areas ?? [],
      links: options?.links ?? {},
      artifacts: [],
      created: now,
      updated: now,
    };

    this.writeWorkspaceFile(id, ws);
  }

  readWorkspace(id: string): Workspace | null {
    return this.readWorkspaceFile(id);
  }

  updateWorkspaceState(id: string, state: Partial<WorkspaceState>): void {
    const ws = this.requireWorkspace(id);
    ws.state = { ...ws.state, ...state };
    ws.updated = new Date().toISOString();
    this.writeWorkspaceFile(id, ws);
  }

  updateWorkspaceLinks(id: string, links: Partial<WorkspaceLinks>): void {
    const ws = this.requireWorkspace(id);
    ws.links = { ...ws.links, ...links };
    ws.updated = new Date().toISOString();
    this.writeWorkspaceFile(id, ws);
  }

  linkArea(id: string, area: string): void {
    const ws = this.requireWorkspace(id);
    if (!ws.areas.includes(area)) {
      ws.areas.push(area);
      ws.updated = new Date().toISOString();
      this.writeWorkspaceFile(id, ws);
    }
  }

  unlinkArea(id: string, area: string): void {
    const ws = this.requireWorkspace(id);
    ws.areas = ws.areas.filter((a) => a !== area);
    ws.updated = new Date().toISOString();
    this.writeWorkspaceFile(id, ws);
  }

  listWorkspaces(): Workspace[] {
    if (!fs.existsSync(this.workspacesDir)) return [];

    const entries = fs.readdirSync(this.workspacesDir, { withFileTypes: true });
    const workspaces: Workspace[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'archive') continue;

      const ws = this.readWorkspaceFile(entry.name);
      if (ws) workspaces.push(ws);
    }

    return workspaces;
  }

  archiveWorkspace(id: string): void {
    const ws = this.requireWorkspace(id);
    const archiveDir = this.archiveDir(id);
    this.ensureDir(archiveDir);

    // Move entire workspace directory contents to archive
    const srcDir = this.workspaceDir(id);
    const srcEntries = fs.readdirSync(srcDir);
    for (const entry of srcEntries) {
      fs.renameSync(path.join(srcDir, entry), path.join(archiveDir, entry));
    }

    // Remove original directory
    fs.rmSync(srcDir, { recursive: true, force: true });
  }

  getActiveWorkspaceId(): string | null {
    // Tier 1: per-session isolation
    const sf = this.sessionFile();
    if (sf) {
      if (fs.existsSync(sf)) {
        return fs.readFileSync(sf, 'utf-8').trim() || null;
      }
      return null; // session active but no workspace set yet
    }

    // Tier 2: global fallback
    const file = this.activeFile();
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8').trim() || null;
  }

  setActiveWorkspaceId(id: string): void {
    const sf = this.sessionFile();
    if (sf) {
      fs.writeFileSync(sf, id + '\n');
      return;
    }
    this.ensureDir(this.workspacesDir);
    fs.writeFileSync(this.activeFile(), id + '\n');
  }

  clearActiveWorkspaceId(): void {
    const sf = this.sessionFile();
    if (sf) {
      if (fs.existsSync(sf)) fs.unlinkSync(sf);
      return;
    }
    const file = this.activeFile();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  appendJournal(id: string, text: string): void {
    this.requireWorkspace(id);
    const entry: JournalEntry = {
      date: new Date().toISOString(),
      text,
    };
    fs.appendFileSync(this.journalFile(id), JSON.stringify(entry) + '\n');
  }

  readJournal(id: string, limit?: number): JournalEntry[] {
    const file = this.journalFile(id);
    if (!fs.existsSync(file)) return [];

    const content = fs.readFileSync(file, 'utf-8').trim();
    if (!content) return [];

    const entries = content.split('\n').map((line) => JSON.parse(line) as JournalEntry);

    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }

    return entries;
  }

  scanDocumentIndex(id: string): WorkspaceDocument[] {
    const dir = this.workspaceDir(id);
    if (!fs.existsSync(dir)) return [];

    return this.scanDirForDocs(dir, dir);
  }

  private scanDirForDocs(baseDir: string, currentDir: string): WorkspaceDocument[] {
    const docs: WorkspaceDocument[] = [];
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        docs.push(...this.scanDirForDocs(baseDir, fullPath));
        continue;
      }

      if (!entry.name.endsWith('.md')) continue;

      const relativePath = path.relative(baseDir, fullPath);
      const description = this.extractFrontmatterDescription(fullPath);
      docs.push({ path: relativePath, description });
    }

    return docs;
  }

  private extractFrontmatterDescription(filePath: string): string | null {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 10);

    if (lines[0] !== '---') return null;

    let inFrontmatter = false;
    for (const line of lines) {
      if (line === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        }
        break; // closing delimiter
      }

      if (inFrontmatter) {
        const match = line.match(/^description:\s*(.+)$/);
        if (match) return match[1].trim();
      }
    }

    return null;
  }

  updateDocumentIndex(id: string): void {
    const ws = this.requireWorkspace(id);
    // Deprecated: writes to legacy 'documents' field. Removed in Phase 5b.
    (ws as Record<string, unknown>).documents = this.scanDocumentIndex(id);
    ws.updated = new Date().toISOString();
    this.writeWorkspaceFile(id, ws);
  }

  // --- Artifact stubs (replaced in Phases 2-4) ---

  addArtifact(_workspaceId: string, _filename: string, _content: string, _options?: AddArtifactOptions): string {
    throw new Error('Not implemented');
  }

  readArtifact(_workspaceId: string, _idOrFilename: string): ArtifactEntry | null {
    throw new Error('Not implemented');
  }

  readArtifactContent(_workspaceId: string, _idOrFilename: string): string | null {
    throw new Error('Not implemented');
  }

  updateArtifact(_workspaceId: string, _id: string, _updates: Partial<ArtifactEntry>): void {
    throw new Error('Not implemented');
  }

  deleteArtifact(_workspaceId: string, _id: string): void {
    throw new Error('Not implemented');
  }

  listArtifacts(_workspaceId: string): ArtifactEntry[] {
    throw new Error('Not implemented');
  }

  syncArtifacts(_workspaceId: string): ArtifactSyncResult {
    throw new Error('Not implemented');
  }
}
