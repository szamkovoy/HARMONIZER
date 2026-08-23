export {
  filterPractices,
  getPracticeCatalog,
  getYogaCatalogSnapshot,
  loadPracticeCatalog,
  sortPracticesForCatalog,
} from "@/modules/practices/core/catalog";
export {
  vimeoAudiotrackForLocale,
  vimeoEmbedHtml,
  vimeoEmbedUrl,
  vimeoPhoneEmbedPageUrl,
  VIMEO_DEFAULT_AUDIOTRACK,
  VIMEO_EMBED_BASE_URL,
  VIMEO_PHONE_EMBED_PAGE_URL,
} from "@/modules/practices/core/vimeo";
export {
  practiceDurationDistance,
  practiceQuality,
  practiceRecordedAtMs,
  recentStackLimitForKind,
  selectPracticeCandidate,
  sortPracticeCandidatesForCatalog,
  sortPracticeCandidatesForRecommendation,
} from "@shared/selector";
export type {
  PracticeCatalog,
  PracticeCatalogFilters,
  PracticeDurationBucket,
  PracticeDurationPolicy,
  PracticeKind,
  PracticeLaunchParams,
  PracticeSummary,
  PracticeVideoMetadata,
} from "@/modules/practices/core/types";
export type {
  PracticeSelectorCandidate,
  PracticeSelectorKind,
  SelectPracticeCandidateInput,
  SelectPracticeCandidateResult,
} from "@shared/selector";
export type {
  PracticeRecommendation,
  PracticeRecommendationLaunch,
} from "@shared/recommendation";
export { PracticeCatalogScreen } from "@/modules/practices/ui/PracticeCatalogScreen";
export { launchPractice } from "@/modules/practices/ui/launchPractice";
