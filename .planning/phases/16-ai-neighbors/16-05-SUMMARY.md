# Plan 16-05 Summary: AI Neighbor UI Elements

## Status: Not Started

This plan requires:
- Add UI elements showing AI neighbor activity
- Show visual indication when AI neighbor is "picking"
- Show pack passing animation

## Prerequisites (from other plans)

- Plan 16-01: AI neighbor types ✅
- Plan 16-02: AI pick logic ✅
- Plan 16-03: Pack passing logic ✅

## Implementation Notes

- Need to show "AI is picking..." indicator when isPicking is true
- Need to update DraftPicker to show/hide cards based on currentPackHolder
- Need to add animation for pack passing

## Files Likely to Modify

- `src/components/draft-picker.tsx` - Update to hide cards when AI has pack
- `src/app/(app)/draft/page.tsx` - Add AI picking indicator
