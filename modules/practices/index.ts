export { filterPractices, loadPracticeCatalog, sortPracticesForCatalog } from "@/modules/practices/core/catalog";
export {
  practiceDurationDistance,
  practiceQuality,
  practiceRecordedAtMs,
  recentStackLimitForKind,
  selectPracticeCandidate,
  sortPracticeCandidatesForCatalog,
  sortPracticeCandidatesForRecommendation,
} from "@/modules/practices/core/selector";
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
} from "@/modules/practices/core/selector";
export type {
  PracticeRecommendation,
  PracticeRecommendationLaunch,
} from "@/modules/practices/core/recommendation";
export { PracticeCatalogScreen } from "@/modules/practices/ui/PracticeCatalogScreen";
export { launchPractice } from "@/modules/practices/ui/launchPractice";
