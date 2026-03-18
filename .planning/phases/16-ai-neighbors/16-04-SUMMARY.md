# Plan 16-04 Summary: Automate AI Neighbor Picks

## Status: Not Started

This plan requires:
- Automate AI neighbor picks with configurable delay
- Trigger AI pick after user makes their selection
- Handle AI pick timer

## Prerequisites (from other plans)

- Plan 16-01: AI neighbor types ✅
- Plan 16-02: AI pick logic ✅
- Plan 16-03: Pack passing logic ✅
- Plan 16-05: UI integration needed

## Implementation Notes

- Need to integrate selectAiPick from ai-neighbor-logic.ts
- Need to add useEffect to trigger AI pick after user picks
- AI pick should respect pickDelay from config
- After AI picks, pass pack back to user

## Files Likely to Modify

- `src/app/(app)/draft/page.tsx` - Add AI pick automation
- `src/lib/ai-neighbor-logic.ts` - Already implemented
