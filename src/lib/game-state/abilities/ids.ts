export function generateAbilityId(): string {
  return `ability-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateTriggeredAbilityId(): string {
  return `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
