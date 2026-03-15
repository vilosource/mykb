export {
  ProvenanceStatus,
  Zone,
  type EntryType,
  type ResolutionStatus,
  type Provenance,
  type KnowledgeEntry,
  type FactEntry,
  type DecisionEntry,
  type GotchaEntry,
  type PatternEntry,
  type LinkEntry,
  type TombstoneEntry,
  type AreaMetadata,
  type ManifestArea,
  type ManifestFile,
  type EntryFilter,
  type AddEntryOptions,
  type AddFactOptions,
  type AddDecisionOptions,
  type AddGotchaOptions,
  type AddPatternOptions,
  type AddLinkOptions,
  type KnowledgeStore,
  type SearchEngine,
} from './types.js';

export {
  BrainNotInitializedError,
  AreaNotFoundError,
  EntryNotFoundError,
  EntryValidationError,
  StoreCorruptionError,
  DatabaseError,
} from './errors.js';

export { resolveBrainPath, brainExists } from './config.js';

export { generateId } from './id.js';

export {
  createDatabase,
  upsertEntry,
  deleteEntry,
  queryEntries,
  searchEntries,
  upsertArea,
  listAreas,
  getAreaStats,
  getLastHydrated,
  setLastHydrated,
  type AreaStats,
} from './db.js';

export { hydrateDatabase, isStale, ensureFresh } from './hydrate.js';

export {
  appendEntry,
  readEntries,
  readAllEntries,
  writeTombstone,
  compactEntries,
} from './store.js';

export {
  createArea,
  readAreaMetadata,
  updateAreaMetadata,
  listAreas as listAreaDirs,
  areaExists,
  deleteArea,
} from './area.js';

export { regenerateManifest, readManifest } from './manifest.js';

export { MykbStore } from './knowledge-store.js';

export { renderMarkdown, renderContextBlock, renderAreaIndex, renderJson } from './render.js';

export { initBrain, isDirtyShutdown, recoverDirtyShutdown } from './init.js';

export { save, saveAndPush } from './save.js';
