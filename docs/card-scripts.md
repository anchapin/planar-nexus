# Card scripts

Cards are described as data: a short JSON file per card listing effects from a
small shared vocabulary. The engine resolves a scripted card from its script
instead of parsing oracle text.

The approach is inspired by how Forge scaled to ~28,500 cards with a card
scripting language. No Forge scripts are copied (Forge is GPL-3.0; this repo
is MIT). Every script here is written for this project.

## Format

```json
{
  "name": "Lightning Strike",
  "oracle": "Lightning Strike deals 3 damage to any target.",
  "spell": [{ "op": "DealDamage", "amount": 3, "target": "any" }]
}
```

- `name`: exact English card name.
- `oracle`: the oracle text the script was written against.
- `spell`: effects of an instant or sorcery, applied in order. Targeted effects
  consume the spell's chosen targets in order.

Ops today: `DealDamage`, `Draw`, `GainLife`, `LoseLife`, `CreateToken`,
`Destroy`, `Exile`, `Counter`, `Pump`, `Surveil`. See
`src/lib/card-scripts/schema.ts`.

## Adding a card

1. Add `src/lib/card-scripts/cards/<card_name>.json`.
2. Run `npx tsx scripts/build-card-script-index.ts`.
3. Run `npx jest src/lib/card-scripts`.

New ops go in `schema.ts` and `interpret.ts`, built on existing engine
resolution helpers.
