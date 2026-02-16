'use client';

import { useLocalStorage } from './use-local-storage';
import { ScryfallCard } from '@/app/actions';

export interface CollectionCard {
  card: ScryfallCard;
  quantity: number;
  addedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  cards: CollectionCard[];
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_COLLECTION_ID = 'default-collection';

export function useCollection() {
  const [collections, setCollections] = useLocalStorage<Collection[]>('card-collections', [
    {
      id: DEFAULT_COLLECTION_ID,
      name: 'My Collection',
      cards: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  const [activeCollectionId, setActiveCollectionId] = useLocalStorage<string>('active-collection', DEFAULT_COLLECTION_ID);

  const activeCollection = collections.find((c) => c.id === activeCollectionId) || collections[0];

  const addCard = (card: ScryfallCard, quantity: number = 1) => {
    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== activeCollectionId) return collection;

        const existingIndex = collection.cards.findIndex((c) => c.card.id === card.id);

        if (existingIndex >= 0) {
          const newCards = [...collection.cards];
          newCards[existingIndex] = {
            ...newCards[existingIndex],
            quantity: newCards[existingIndex].quantity + quantity,
          };
          return { ...collection, cards: newCards, updatedAt: new Date().toISOString() };
        }

        return {
          ...collection,
          cards: [
            ...collection.cards,
            { card, quantity, addedAt: new Date().toISOString() },
          ],
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  const removeCard = (cardId: string, quantity: number = 1) => {
    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== activeCollectionId) return collection;

        const existingIndex = collection.cards.findIndex((c) => c.card.id === cardId);
        if (existingIndex < 0) return collection;

        const existingCard = collection.cards[existingIndex];
        if (existingCard.quantity <= quantity) {
          return {
            ...collection,
            cards: collection.cards.filter((c) => c.card.id !== cardId),
            updatedAt: new Date().toISOString(),
          };
        }

        const newCards = [...collection.cards];
        newCards[existingIndex] = {
          ...existingCard,
          quantity: existingCard.quantity - quantity,
        };
        return { ...collection, cards: newCards, updatedAt: new Date().toISOString() };
      })
    );
  };

  const createCollection = (name: string) => {
    const newCollection: Collection = {
      id: crypto.randomUUID(),
      name,
      cards: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCollections((prev) => [...prev, newCollection]);
    setActiveCollectionId(newCollection.id);
    return newCollection;
  };

  const deleteCollection = (collectionId: string) => {
    if (collectionId === DEFAULT_COLLECTION_ID) return;
    setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    if (activeCollectionId === collectionId) {
      setActiveCollectionId(DEFAULT_COLLECTION_ID);
    }
  };

  const renameCollection = (collectionId: string, name: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId ? { ...c, name, updatedAt: new Date().toISOString() } : c))
    );
  };

  const importFromCSV = (csv: string) => {
    const lines = csv.trim().split('\n');
    const newCards: CollectionCard[] = [];

    for (const line of lines) {
      const match = line.match(/^(\d+)?\s*[,;]?\s*(.+)$/);
      if (!match) continue;

      const quantity = parseInt(match[1]) || 1;
      const name = match[2].trim();

      // Create a placeholder card for now - the UI will show the name
      // In a real implementation, we'd look up the card via Scryfall
      newCards.push({
        card: {
          id: `imported-${name.toLowerCase().replace(/\s+/g, '-')}`,
          name,
          color_identity: [],
          set: '',
          collector_number: '',
        } as unknown as ScryfallCard,
        quantity,
        addedAt: new Date().toISOString(),
      });
    }

    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== activeCollectionId) return collection;

        const updatedCards = [...collection.cards];
        for (const newCard of newCards) {
          const existingIndex = updatedCards.findIndex((c) => c.card.id === newCard.card.id);
          if (existingIndex >= 0) {
            updatedCards[existingIndex].quantity += newCard.quantity;
          } else {
            updatedCards.push(newCard);
          }
        }

        return { ...collection, cards: updatedCards, updatedAt: new Date().toISOString() };
      })
    );
  };

  const exportToCSV = () => {
    return activeCollection.cards
      .map((c) => `${c.quantity},${c.card.name}`)
      .join('\n');
  };

  /**
   * Compare a deck list against the collection
   * Returns cards that are missing or insufficient in quantity
   */
  const compareDeckWithCollection = (deckCards: { name: string; quantity: number }[]): {
    name: string;
    deckQuantity: number;
    collectionQuantity: number;
    missing: number;
    status: 'ok' | 'insufficient' | 'missing';
  }[] => {
    const collectionMap = new Map<string, number>();
    for (const card of activeCollection.cards) {
      const current = collectionMap.get(card.card.name.toLowerCase()) || 0;
      collectionMap.set(card.card.name.toLowerCase(), current + card.quantity);
    }

    return deckCards.map((deckCard) => {
      const collectionQty = collectionMap.get(deckCard.name.toLowerCase()) || 0;
      const missing = Math.max(0, deckCard.quantity - collectionQty);
      
      let status: 'ok' | 'insufficient' | 'missing' = 'ok';
      if (collectionQty === 0) status = 'missing';
      else if (collectionQty < deckCard.quantity) status = 'insufficient';

      return {
        name: deckCard.name,
        deckQuantity: deckCard.quantity,
        collectionQuantity: collectionQty,
        missing,
        status,
      };
    });
  };

  /**
   * Generate a trade list - cards with quantity > 4 (playable duplicates)
   */
  const generateTradeList = () => {
    return activeCollection.cards
      .filter((c) => c.quantity > 4)
      .map((c) => ({
        name: c.card.name,
        quantity: c.quantity - 4, // Keep 4 for playability
        set: c.card.set,
        condition: 'near mint', // Default condition
      }));
  };

  /**
   * Get collection value estimate (basic - counts cards only)
   */
  const getCollectionStats = () => {
    const totalCards = activeCollection.cards.reduce((sum, c) => sum + c.quantity, 0);
    const uniqueCards = activeCollection.cards.length;
    const playableCards = activeCollection.cards.filter((c) => c.quantity >= 4).length;
    const tradeableCards = activeCollection.cards.filter((c) => c.quantity > 4).length;
    
    // Count by color
    const colorCounts: Record<string, number> = {};
    for (const card of activeCollection.cards) {
      const colors = card.card.colors || [];
      if (colors.length === 0) {
        colorCounts['colorless'] = (colorCounts['colorless'] || 0) + card.quantity;
      } else {
        for (const color of colors) {
          colorCounts[color] = (colorCounts[color] || 0) + card.quantity;
        }
      }
    }

    return {
      totalCards,
      uniqueCards,
      playableCards,
      tradeableCards,
      colorCounts,
    };
  };

  return {
    collections,
    activeCollection,
    activeCollectionId,
    setActiveCollectionId,
    addCard,
    removeCard,
    createCollection,
    deleteCollection,
    renameCollection,
    importFromCSV,
    exportToCSV,
    compareDeckWithCollection,
    generateTradeList,
    getCollectionStats,
  };
}
