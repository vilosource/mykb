// --- Enums ---

export enum ProvenanceStatus {
  Verified = 'verified',
  Unverified = 'unverified',
  Stale = 'stale',
  Expires = 'expires',
}

export enum Zone {
  Active = 'active',
  Established = 'established',
  Archive = 'archive',
}

// --- Value types ---

export type EntryType = 'fact' | 'decision' | 'gotcha' | 'pattern' | 'link';

export type ResolutionStatus = null | 'resolved' | 'mitigated' | 'wontfix';

export type Provenance = {
  status: ProvenanceStatus;
  date?: string;
  source?: string;
  detail?: string;
};

// --- Knowledge entry types ---

export type KnowledgeEntry = {
  id: string;
  area: string;
  type: EntryType;
  text: string;
  tags: string[];
  provenance: Provenance;
  zone: Zone;
  created: string;
  updated: string;
};

export type FactEntry = KnowledgeEntry & {
  type: 'fact';
};

export type DecisionEntry = KnowledgeEntry & {
  type: 'decision';
  why?: string;
  rejected?: string;
  context?: string;
};

export type GotchaEntry = KnowledgeEntry & {
  type: 'gotcha';
  failed: boolean;
  resolution: ResolutionStatus;
};

export type PatternEntry = KnowledgeEntry & {
  type: 'pattern';
};

export type LinkEntry = KnowledgeEntry & {
  type: 'link';
  url: string;
};

export type TombstoneEntry = {
  id: string;
  area: string;
  deleted: true;
  updated: string;
};

// --- Metadata types ---

export type AreaMetadata = {
  id: string;
  name: string;
  summary: string;
  owner: string;
  tags: string[];
  created: string;
  updated: string;
};

export type ManifestArea = {
  id: string;
  summary: string;
  owner: string;
  updated: string;
  tags: string[];
};

export type ManifestFile = {
  version: number;
  areas: ManifestArea[];
};

// --- Area context for workspace rendering ---

export type AreaContext = {
  id: string;
  summary: string;
  stats: {
    facts: number;
    decisions: number;
    gotchas: number;
    patterns: number;
    links: number;
  };
};

// --- Filter types ---

export type EntryFilter = {
  area?: string;
  type?: EntryType;
  zone?: Zone;
  excludeZone?: Zone;
  tags?: string[];
  provStatus?: ProvenanceStatus;
  search?: string;
};

// --- Option types for add methods ---

export type AddEntryOptions = {
  tags?: string[];
  zone?: Zone;
  provenance?: Provenance;
};

export type AddFactOptions = AddEntryOptions;

export type AddDecisionOptions = AddEntryOptions & {
  why?: string;
  rejected?: string;
  context?: string;
};

export type AddGotchaOptions = AddEntryOptions & {
  failed?: boolean;
  resolution?: ResolutionStatus;
};

export type AddPatternOptions = AddEntryOptions;

export type AddLinkOptions = AddEntryOptions;

// --- Service interfaces ---

export interface KnowledgeStore {
  addFact(area: string, text: string, options?: AddFactOptions): string;
  addDecision(area: string, text: string, options?: AddDecisionOptions): string;
  addGotcha(area: string, text: string, options?: AddGotchaOptions): string;
  addPattern(area: string, text: string, options?: AddPatternOptions): string;
  addLink(area: string, text: string, url: string, options?: AddLinkOptions): string;
  updateEntry(area: string, id: string, updates: Partial<KnowledgeEntry>): void;
  deleteEntry(area: string, id: string): void;
  verifyEntry(area: string, id: string): void;
  promoteEntry(area: string, id: string): void;
  archiveEntry(area: string, id: string): void;
  loadArea(area: string, filter?: EntryFilter): KnowledgeEntry[];
  search(query: string): KnowledgeEntry[];
  matchAreas(text: string): { area: string; score: number }[];
  compact(area?: string): void;
}

export interface SearchEngine {
  searchEntries(query: string): KnowledgeEntry[];
  matchAreas(text: string): { area: string; score: number }[];
}

// --- Artifact types ---

export type ArtifactType = 'plan' | 'design' | 'analysis' | 'report' | 'notes' | 'prompt' | 'other';

export type ArtifactEntry = {
  id: string;
  filename: string;
  type: ArtifactType;
  description: string;
  tags: string[];
  areas: string[];
  created: string;
  updated: string;
};

export type ArtifactTombstone = {
  id: string;
  deleted: true;
  updated: string;
};

export type ArtifactSummary = {
  id: string;
  filename: string;
  type: ArtifactType;
  description: string;
};

export type AddArtifactOptions = {
  type?: ArtifactType;
  description?: string;
  tags?: string[];
  areas?: string[];
};

export type ArtifactSyncResult = {
  tracked: ArtifactEntry[];
  untracked: string[];
  missing: ArtifactEntry[];
};

// --- Workspace types ---

export type WorkspaceState = {
  phase?: string;
  active?: string;
  blocked?: string;
  next?: string;
};

export type WorkspaceLinks = {
  jira?: string;
  wiki?: string;
  repos?: string[];
};

export type Workspace = {
  id: string;
  name: string;
  state: WorkspaceState;
  areas: string[];
  links: WorkspaceLinks;
  artifacts: ArtifactSummary[];
  created: string;
  updated: string;
};

export type JournalEntry = {
  date: string;
  text: string;
};

export type NoteEntry = {
  id: string;
  date: string;
  text: string;
  tags: string[];
};

export type HandoffData = {
  text: string;
  updated: string;
};

// --- Checkpoint types ---

export type CheckpointKnowledgeEntry = {
  type: 'fact' | 'decision' | 'gotcha' | 'pattern';
  area: string;
  text: string;
  tags?: string[];
  // decision-specific
  why?: string;
  rejected?: string;
  context?: string;
  // gotcha-specific
  source?: string;
  failed?: boolean;
};

export type CheckpointInput = {
  journal?: string;
  handoff?: string;
  state?: Partial<WorkspaceState>;
  knowledge?: CheckpointKnowledgeEntry[];
};

export type CheckpointResult = {
  journal: boolean;
  handoff: boolean;
  state: string[];
  knowledge: { added: number; errors: string[] };
};

export type CreateWorkspaceOptions = {
  areas?: string[];
  links?: WorkspaceLinks;
};

export interface WorkspaceStorage {
  createWorkspace(id: string, name: string, options?: CreateWorkspaceOptions): void;
  readWorkspace(id: string): Workspace | null;
  resolveWorkspaceId(id: string): string;
  updateWorkspaceState(id: string, state: Partial<WorkspaceState>): void;
  updateWorkspaceLinks(id: string, links: Partial<WorkspaceLinks>): void;
  linkArea(id: string, area: string): void;
  unlinkArea(id: string, area: string): void;
  listWorkspaces(): Workspace[];
  archiveWorkspace(id: string): void;
  getActiveWorkspaceId(): string | null;
  setActiveWorkspaceId(id: string): void;
  clearActiveWorkspaceId(): void;
  appendJournal(id: string, text: string): void;
  readJournal(id: string, limit?: number): JournalEntry[];
  appendNote(id: string, text: string, tags?: string[]): string;
  readNotes(id: string, tag?: string): NoteEntry[];
  deleteNote(id: string, noteId: string): void;
  // Handoff
  writeHandoff(id: string, text: string): void;
  readHandoff(id: string): HandoffData | null;
  clearHandoff(id: string): void;
  // Artifact CRUD
  addArtifact(workspaceId: string, filename: string, content: string, options?: AddArtifactOptions): string;
  readArtifact(workspaceId: string, idOrFilename: string): ArtifactEntry | null;
  readArtifactContent(workspaceId: string, idOrFilename: string): string | null;
  updateArtifact(workspaceId: string, id: string, updates: Partial<ArtifactEntry>): void;
  deleteArtifact(workspaceId: string, id: string): void;
  listArtifacts(workspaceId: string): ArtifactEntry[];
  syncArtifacts(workspaceId: string): ArtifactSyncResult;
}
