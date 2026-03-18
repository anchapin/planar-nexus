import { describe, it, expect, vi } from 'vitest';
import { searchCardsTool } from './card-search';
import { searchCards } from '@/lib/server-card-operations';

// Mock the server card operations
vi.mock('@/lib/server-card-operations', () => ({
  searchCards: vi.fn(),
}));

describe('searchCardsTool', () => {
  it('should be defined', () => {
    expect(searchCardsTool).toBeDefined();
    expect(searchCardsTool.description).toContain('Search for Magic: The Gathering cards');
  });

  it('should call searchCards with correct parameters', async () => {
    const mockResults = [
      {
        id: '1',
        name: 'Black Lotus',
        type_line: 'Artifact',
        mana_cost: '{0}',
        oracle_text: '{T}, Sacrifice Black Lotus: Add three mana of any one color.',
        colors: [],
        rarity: 'rare',
        legalities: { commander: 'banned', vintage: 'restricted' },
      },
    ];

    (searchCards as any).mockResolvedValue(mockResults);

    const result = await (searchCardsTool as any).execute({
      query: 'Black Lotus',
      limit: 1,
      format: 'vintage',
    }, { toolCallId: '1', messages: [] });

    expect(searchCards).toHaveBeenCalledWith('Black Lotus', 1, 'vintage');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Black Lotus');
  });

  it('should handle errors gracefully', async () => {
    (searchCards as any).mockRejectedValue(new Error('DB Error'));

    const result = await (searchCardsTool as any).execute({
      query: 'error',
    }, { toolCallId: '1', messages: [] });

    expect(result).toHaveProperty('error');
    expect(result.error).toBe('Failed to search cards database.');
  });
});
