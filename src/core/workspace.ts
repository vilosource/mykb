import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  Workspace,
  WorkspaceState,
  WorkspaceLinks,
  WorkspaceStorage,
  CreateWorkspaceOptions,
  JournalEntry,
  NoteEntry,
  HandoffData,
  CheckpointInput,
  CheckpointResult,
  AddArtifactOptions,
  ArtifactEntry,
  ArtifactSyncResult,
} from './types.js';
import { WorkspaceNotFoundError, EntryValidationError, ArtifactNotFoundError } from './errors.js';
import { generateId } from './id.js';

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

  private notesFile(id: string): string {
    return path.join(this.workspaceDir(id), 'notes.jsonl');
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

  resolveWorkspaceId(id: string): string {
    // Exact match first
    if (this.readWorkspaceFile(id)) return id;

    // Prefix match
    if (!fs.existsSync(this.workspacesDir)) {
      throw new WorkspaceNotFoundError(`Workspace '${id}' not found.`);
    }

    const entries = fs.readdirSync(this.workspacesDir, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive') continue;
      if (entry.name.startsWith(id)) {
        matches.push(entry.name);
      }
    }

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new WorkspaceNotFoundError(
        `Workspace '${id}' is ambiguous. Did you mean: ${matches.join(', ')}?`,
      );
    }
    throw new WorkspaceNotFoundError(`Workspace '${id}' not found.`);
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

  appendNote(id: string, text: string, tags?: string[]): string {
    this.requireWorkspace(id);
    const noteId = generateId();
    const entry: NoteEntry = {
      id: noteId,
      date: new Date().toISOString(),
      text,
      tags: tags ?? [],
    };
    fs.appendFileSync(this.notesFile(id), JSON.stringify(entry) + '\n');
    return noteId;
  }

  readNotes(id: string, tag?: string): NoteEntry[] {
    const file = this.notesFile(id);
    if (!fs.existsSync(file)) return [];

    const content = fs.readFileSync(file, 'utf-8').trim();
    if (!content) return [];

    // Resolve tombstones: last entry per ID wins
    const byId = new Map<string, NoteEntry | null>();
    for (const line of content.split('\n')) {
      const parsed = JSON.parse(line) as NoteEntry & { deleted?: true };
      if (parsed.deleted) {
        byId.set(parsed.id, null);
      } else {
        byId.set(parsed.id, parsed);
      }
    }

    const entries: NoteEntry[] = [];
    for (const entry of byId.values()) {
      if (entry !== null) entries.push(entry);
    }

    if (tag) {
      return entries.filter((e) => e.tags.includes(tag));
    }

    return entries;
  }

  deleteNote(id: string, noteId: string): void {
    this.requireWorkspace(id);
    const notes = this.readNotes(id);
    const note = notes.find((n) => n.id === noteId);
    if (!note) {
      throw new EntryValidationError(`Note not found: ${noteId}`);
    }
    const tombstone = { id: noteId, deleted: true, updated: new Date().toISOString() };
    fs.appendFileSync(this.notesFile(id), JSON.stringify(tombstone) + '\n');
  }

  // --- Handoff methods ---

  private continuityFile(id: string): string {
    return path.join(this.workspaceDir(id), 'continuity.md');
  }

  writeHandoff(id: string, text: string): void {
    this.requireWorkspace(id);
    const now = new Date().toISOString();
    const content = `---\nupdated: ${now}\n---\n${text}\n`;
    fs.writeFileSync(this.continuityFile(id), content);
  }

  readHandoff(id: string): HandoffData | null {
    const file = this.continuityFile(id);
    if (!fs.existsSync(file)) return null;

    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return null;

    // Parse YAML frontmatter
    let updated = '';
    let textStart = 0;

    if (raw.startsWith('---\n')) {
      const endIdx = raw.indexOf('\n---\n', 4);
      if (endIdx !== -1) {
        const frontmatter = raw.slice(4, endIdx);
        const match = frontmatter.match(/^updated:\s*(.+)$/m);
        if (match) updated = match[1].trim();
        textStart = endIdx + 5; // skip past \n---\n
      }
    }

    const text = raw.slice(textStart).trim();
    if (!text) return null;

    return { text, updated };
  }

  clearHandoff(id: string): void {
    this.requireWorkspace(id);
    const file = this.continuityFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // --- Artifact methods ---

  private docsDir(id: string): string {
    return path.join(this.workspaceDir(id), 'docs');
  }

  private artifactsFile(id: string): string {
    return path.join(this.workspaceDir(id), 'artifacts.jsonl');
  }

  private inferArtifactType(filename: string): import('./types.js').ArtifactType {
    const suffixMap: [RegExp, import('./types.js').ArtifactType][] = [
      [/-plan\.md$/i, 'plan'],
      [/-design\.md$/i, 'design'],
      [/-analysis\.md$/i, 'analysis'],
      [/-architecture\.md$/i, 'design'],
      [/-guide\.md$/i, 'report'],
      [/-specification\.md$/i, 'design'],
      [/-strategy\.md$/i, 'plan'],
      [/-proposal\.md$/i, 'notes'],
      [/-implementation\.md$/i, 'plan'],
    ];
    for (const [pattern, type] of suffixMap) {
      if (pattern.test(filename)) return type;
    }
    return 'other';
  }

  private extractDescriptionFromContent(content: string): string | null {
    const lines = content.split('\n').slice(0, 10);
    if (lines[0] !== '---') return null;

    let inFrontmatter = false;
    for (const line of lines) {
      if (line === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        }
        break;
      }
      if (inFrontmatter) {
        const match = line.match(/^description:\s*(.+)$/);
        if (match) return match[1].trim();
      }
    }
    return null;
  }

  private refreshArtifactSummaries(id: string): void {
    const ws = this.requireWorkspace(id);
    const artifacts = this.listArtifacts(id);
    ws.artifacts = artifacts.map((a) => ({
      id: a.id,
      filename: a.filename,
      type: a.type,
      description: a.description,
    }));
    ws.updated = new Date().toISOString();
    this.writeWorkspaceFile(id, ws);
  }

  addArtifact(workspaceId: string, filename: string, content: string, options?: AddArtifactOptions): string {
    this.requireWorkspace(workspaceId);

    if (!filename.endsWith('.md')) {
      throw new EntryValidationError(`Filename must end with .md: ${filename}`);
    }

    // Reject path separators to prevent directory traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new EntryValidationError(`Filename must not contain path separators: ${filename}`);
    }

    // Check for duplicate filename in metadata
    const existing = this.listArtifacts(workspaceId);
    if (existing.some((a) => a.filename === filename)) {
      throw new EntryValidationError(`Artifact '${filename}' already exists`);
    }

    // Ensure docs/ dir exists and write file
    const docsDir = this.docsDir(workspaceId);
    this.ensureDir(docsDir);
    const filePath = path.join(docsDir, filename);
    if (fs.existsSync(filePath)) {
      // Register-only mode: file already on disk, just register metadata
    } else {
      // Exclusive create: prevents race condition where two processes both
      // pass the duplicate check and try to write the same file
      try {
        fs.writeFileSync(filePath, content, { flag: 'wx' });
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new EntryValidationError(`Artifact '${filename}' already exists`);
        }
        throw e;
      }
    }

    const id = generateId();
    const now = new Date().toISOString();
    const entry: ArtifactEntry = {
      id,
      filename,
      type: options?.type ?? this.inferArtifactType(filename),
      description: options?.description ?? this.extractDescriptionFromContent(content) ?? '',
      tags: options?.tags ?? [],
      areas: options?.areas ?? [],
      created: now,
      updated: now,
    };

    fs.appendFileSync(this.artifactsFile(workspaceId), JSON.stringify(entry) + '\n');
    this.refreshArtifactSummaries(workspaceId);
    return id;
  }

  listArtifacts(workspaceId: string): ArtifactEntry[] {
    const file = this.artifactsFile(workspaceId);
    if (!fs.existsSync(file)) return [];

    const content = fs.readFileSync(file, 'utf-8').trim();
    if (!content) return [];

    // Resolve tombstones: last entry per ID wins
    const byId = new Map<string, ArtifactEntry | null>();
    for (const line of content.split('\n')) {
      const parsed = JSON.parse(line) as ArtifactEntry & { deleted?: true };
      if (parsed.deleted) {
        byId.set(parsed.id, null);
      } else {
        byId.set(parsed.id, parsed);
      }
    }

    const result: ArtifactEntry[] = [];
    for (const entry of byId.values()) {
      if (entry !== null) result.push(entry);
    }
    return result;
  }

  readArtifact(workspaceId: string, idOrFilename: string): ArtifactEntry | null {
    const artifacts = this.listArtifacts(workspaceId);
    // ID takes precedence over filename (D6)
    return artifacts.find((a) => a.id === idOrFilename)
      ?? artifacts.find((a) => a.filename === idOrFilename)
      ?? null;
  }

  deleteArtifact(workspaceId: string, id: string): void {
    const entry = this.readArtifact(workspaceId, id);
    if (!entry) {
      throw new ArtifactNotFoundError(`Artifact not found: ${id}`);
    }
    // Append tombstone
    const tombstone = { id: entry.id, deleted: true, updated: new Date().toISOString() };
    fs.appendFileSync(this.artifactsFile(workspaceId), JSON.stringify(tombstone) + '\n');
    // Remove file
    const filePath = path.join(this.docsDir(workspaceId), entry.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.refreshArtifactSummaries(workspaceId);
  }

  readArtifactContent(workspaceId: string, idOrFilename: string): string | null {
    const entry = this.readArtifact(workspaceId, idOrFilename);
    if (!entry) return null;
    const filePath = path.join(this.docsDir(workspaceId), entry.filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  updateArtifact(workspaceId: string, id: string, updates: Partial<ArtifactEntry>): void {
    const entry = this.readArtifact(workspaceId, id);
    if (!entry) throw new ArtifactNotFoundError(`Artifact not found: ${id}`);

    const updated: ArtifactEntry = {
      ...entry,
      ...updates,
      id: entry.id, // never allow ID change
      filename: entry.filename, // never allow filename change (would desync from file on disk)
      updated: new Date().toISOString(),
    };
    fs.appendFileSync(this.artifactsFile(workspaceId), JSON.stringify(updated) + '\n');
    this.refreshArtifactSummaries(workspaceId);
  }

  syncArtifacts(workspaceId: string): ArtifactSyncResult {
    const docsDir = this.docsDir(workspaceId);
    const artifacts = this.listArtifacts(workspaceId);
    const trackedFilenames = new Set(artifacts.map((a) => a.filename));

    // Scan docs/ for .md files
    const filesOnDisk = new Set<string>();
    if (fs.existsSync(docsDir)) {
      for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        filesOnDisk.add(entry.name);
      }
    }

    const tracked: ArtifactEntry[] = [];
    const missing: ArtifactEntry[] = [];
    for (const artifact of artifacts) {
      if (filesOnDisk.has(artifact.filename)) {
        tracked.push(artifact);
      } else {
        missing.push(artifact);
      }
    }

    const untracked: string[] = [];
    for (const file of filesOnDisk) {
      if (!trackedFilenames.has(file)) {
        untracked.push(file);
      }
    }

    return { tracked, untracked, missing };
  }

  checkpoint(id: string, input: CheckpointInput, addKnowledge?: (type: string, area: string, text: string, options: Record<string, unknown>) => string): CheckpointResult {
    const ws = this.readWorkspace(id);
    if (!ws) {
      throw new Error(`Workspace '${id}' not found`);
    }

    const result: CheckpointResult = {
      journal: false,
      handoff: false,
      state: [],
      knowledge: { added: 0, errors: [] },
    };

    // State first (so journal/handoff timestamps reflect post-state)
    if (input.state) {
      const fields: string[] = [];
      if (input.state.phase !== undefined) fields.push('phase');
      if (input.state.active !== undefined) fields.push('active');
      if (input.state.blocked !== undefined) fields.push('blocked');
      if (input.state.next !== undefined) fields.push('next');
      if (fields.length > 0) {
        this.updateWorkspaceState(id, input.state);
        result.state = fields;
      }
    }

    // Journal
    if (input.journal) {
      this.appendJournal(id, input.journal);
      result.journal = true;
    }

    // Knowledge entries
    if (input.knowledge && input.knowledge.length > 0 && addKnowledge) {
      for (const entry of input.knowledge) {
        try {
          const opts: Record<string, unknown> = {};
          if (entry.tags) opts.tags = entry.tags;
          if (entry.type === 'decision') {
            if (entry.why) opts.why = entry.why;
            if (entry.rejected) opts.rejected = entry.rejected;
            if (entry.context) opts.context = entry.context;
          }
          if (entry.type === 'gotcha') {
            if (entry.failed !== undefined) opts.failed = entry.failed;
          }
          addKnowledge(entry.type, entry.area, entry.text, opts);
          result.knowledge.added++;
        } catch (err) {
          result.knowledge.errors.push(`${entry.type}/${entry.area}: ${(err as Error).message}`);
        }
      }
    }

    // Handoff last (timestamp reflects completed checkpoint)
    if (input.handoff) {
      this.writeHandoff(id, input.handoff);
      result.handoff = true;
    }

    return result;
  }
}
