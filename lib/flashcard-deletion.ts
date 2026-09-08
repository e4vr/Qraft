import type { AppState } from './medguard-types';

/** Decks live inside one user's app state. Deleting a deck removes its tree only. */
export function deleteFlashcardDeck(state: AppState, deckId: string, qbankId: string): AppState {
  const deck = state.flashcardDecks.find(item => item.id === deckId && item.qbankId === qbankId);
  if (!deck) return state;
  const deletedDecks = new Set([deckId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.flashcardDecks) {
      if (item.qbankId === qbankId && item.parentId && deletedDecks.has(item.parentId) && !deletedDecks.has(item.id)) {
        deletedDecks.add(item.id);
        changed = true;
      }
    }
  }
  const deletedCards = new Set(state.flashcards.filter(card => deletedDecks.has(card.deckId) && card.qbankId === qbankId).map(card => card.id));
  return {
    ...state,
    flashcardDecks: state.flashcardDecks.filter(item => !deletedDecks.has(item.id)),
    flashcards: state.flashcards.filter(card => !deletedCards.has(card.id)),
    flashcardSchedules: Object.fromEntries(Object.entries(state.flashcardSchedules).filter(([id]) => !deletedCards.has(id))),
    flashcardReviewLog: state.flashcardReviewLog.filter(log => !deletedCards.has(log.cardId)),
  };
}
