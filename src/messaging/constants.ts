/** Topic for word deletion (one `{ wordIds }` message per deleted batch). Consumed to remove word progress. */
export const WORDS_DELETED_TOPIC = 'words_deleted';

/**
 * Published by curriculum-service when a Wordsly Path release drops items that
 * were archived (`{ itemIds }`, at most 500 per message). Consumed to remove the
 * learners' Path progress for them.
 */
export const PATH_ITEMS_RETIRED_TOPIC = 'path_items_retired';

/**
 * Published by curriculum-service after a learner's Path progress changes:
 * `{ userLoginId, lessonsCompleted, unitsCompleted, stagesCompleted,
 * occurredAt }`, totals rather than deltas, keyed by user. Consumed to keep
 * the report's Path totals and unlock Path achievements.
 */
export const PATH_PROGRESS_TOPIC = 'path_progress';

/** Every topic this service consumes; created at boot if missing (main.ts). */
export const CONSUMED_TOPICS = [
    WORDS_DELETED_TOPIC,
    PATH_ITEMS_RETIRED_TOPIC,
    PATH_PROGRESS_TOPIC,
];
