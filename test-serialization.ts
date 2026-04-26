import { createInitialGameState } from "./src/lib/game-state/game-state";

const state = createInitialGameState(["Alice", "Bob"]);
const json = JSON.stringify(state);
console.log("JSON length:", json.length);
const parsed = JSON.parse(json);
console.log("Players type:", typeof parsed.players);
console.log("Players keys:", Object.keys(parsed.players));
if (Object.keys(parsed.players).length === 0) {
  console.log("BUG CONFIRMED: Map was serialized as empty object!");
} else {
  console.log("No bug? Interesting.");
}
