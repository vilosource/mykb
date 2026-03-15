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
  listAreas,
  areaExists,
  deleteArea,
} from './area.js';

export { regenerateManifest, readManifest } from './manifest.js';
