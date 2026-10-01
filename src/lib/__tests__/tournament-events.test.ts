/**
 * Unit coverage for the tournament engine (src/lib/tournament-events.ts).
 *
 * The module owns bracket construction, Swiss pairing, match recording,
 * standings/tiebreakers, prize distribution and event history. None of it was
 * exercised: no test file referenced it, so every guard clause and every
 * scoring branch shipped unverified.
 *
 * Where the module has a quirk rather than a bug (addToEventHistory always
 * derives placement from the first standing), the test pins the actual
 * behaviour and says so, rather than asserting what the name implies.
 */

import {
  DEFAULT_PRIZES,
  TOURNAMENT_STORAGE_KEYS,
  addToEventHistory,
  advanceRound,
  calculateStandings,
  cancelEvent,
  completeEvent,
  createTournament,
  createTournamentEvent,
  distributePrizes,
  getMatchForPlayer,
  getTotalPrizes,
  getTournamentChampion,
  openRegistration,
  recordMatchResult,
  registerPlayer,
  startEvent,
  startTournament,
  unregisterPlayer,
  type EventHistory,
  type EventStandings,
  type Match,
  type Standing,
  type TournamentEvent,
} from "../tournament-events";

function standing(playerId: string, over: Partial<Standing> = {}): Standing {
  return {
    playerId,
    name: playerId.toUpperCase(),
    wins: 0,
    losses: 0,
    draws: 0,
    matchPoints: 0,
    opponentMatchWinPercentages: 0,
    tiebreakers: [0, 0, 0],
    ...over,
  };
}

function match(id: string, over: Partial<Match> = {}): Match {
  return {
    id,
    round: 1,
    player1Id: "p1",
    player2Id: "p2",
    bye: false,
    ...over,
  };
}

/** A two-player active event with one undecided round-1 match. */
function activeEvent(over: Partial<TournamentEvent> = {}): TournamentEvent {
  return {
    id: "evt",
    name: "Friday Night Standard",
    format: "swiss",
    status: "active",
    players: [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
    ],
    matches: [match("m1")],
    currentRound: 1,
    totalRounds: 2,
    standings: [standing("p1"), standing("p2")],
    prizes: DEFAULT_PRIZES,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function byPlayer(standings: Standing[], playerId: string): Standing {
  const found = standings.find((s) => s.playerId === playerId);
  if (!found) throw new Error(`no standing for ${playerId}`);
  return found;
}

describe("constants", () => {
  it("namespaces every storage key under pn:tournament", () => {
    for (const key of Object.values(TOURNAMENT_STORAGE_KEYS)) {
      expect(key.startsWith("pn:tournament:")).toBe(true);
    }
  });

  it("pays out exactly 90% of the pool across the default top eight", () => {
    const total = DEFAULT_PRIZES.reduce((sum, p) => sum + p.percentage, 0);
    expect(total).toBe(90);
    expect(DEFAULT_PRIZES.map((p) => p.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

describe("createTournament", () => {
  const names = ["Ana", "Ben", "Cara", "Dev"];

  it("seeds players in the order given and zeroes their standings", () => {
    const event = createTournament("Cup", "swiss", names);
    expect(event.players.map((p) => p.name)).toEqual(names);
    expect(event.players.map((p) => p.seed)).toEqual([1, 2, 3, 4]);
    expect(event.status).toBe("registration");
    expect(event.currentRound).toBe(0);
    for (const s of event.standings) {
      expect(s.wins).toBe(0);
      expect(s.losses).toBe(0);
      expect(s.matchPoints).toBe(0);
    }
    expect(event.standings.map((s) => s.playerId).sort()).toEqual(
      event.players.map((p) => p.id).sort(),
    );
  });

  it("gives every player a distinct id", () => {
    const event = createTournament("Cup", "swiss", names);
    expect(new Set(event.players.map((p) => p.id)).size).toBe(names.length);
  });

  it("sets Swiss rounds to ceil(log2(players))", () => {
    expect(createTournament("Cup", "swiss", names).totalRounds).toBe(2);
    expect(
      createTournament("Cup", "swiss", [...names, "Eli"]).totalRounds,
    ).toBe(3);
  });

  it("pairs every Swiss player in round one", () => {
    const event = createTournament("Cup", "swiss", names);
    const paired = event.matches.flatMap((m) => [m.player1Id, m.player2Id]);
    for (const player of event.players) {
      expect(paired).toContain(player.id);
    }
    expect(event.matches.every((m) => m.round === 1)).toBe(true);
  });

  it("pads a single-elimination bracket up to a power of two with BYEs", () => {
    // 5 players -> bracket of 8 -> 3 BYE seats, 4+2+1 = 7 matches.
    const event = createTournament("Cup", "single-elimination", [
      ...names,
      "Eli",
    ]);
    expect(event.matches).toHaveLength(7);
    const rounds = event.matches.map((m) => m.round);
    expect(Math.min(...rounds)).toBe(1);
    expect(Math.max(...rounds)).toBe(3);
    expect(event.matches.filter((m) => m.round === 1)).toHaveLength(4);
    expect(event.matches.filter((m) => m.round === 3)).toHaveLength(1);
    // The BYE seats are bracket filler, never registered players.
    expect(event.players.map((p) => p.name)).not.toContain("BYE");
  });

  it("honours an explicit round count", () => {
    expect(
      createTournament("Cup", "single-elimination", names, DEFAULT_PRIZES, 9)
        .totalRounds,
    ).toBe(9);
  });

  it("defaults the prize table and accepts an override", () => {
    expect(createTournament("Cup", "swiss", names).prizes).toBe(DEFAULT_PRIZES);
    const custom = [{ position: 1, percentage: 100 }];
    expect(createTournament("Cup", "swiss", names, custom).prizes).toBe(custom);
  });
});

describe("createTournamentEvent", () => {
  it("starts empty, in registration, with the default prizes", () => {
    const event = createTournamentEvent(
      "Prerelease",
      "sealed",
      "regular",
      "me",
    );
    expect(event.players).toEqual([]);
    expect(event.matches).toEqual([]);
    expect(event.standings).toEqual([]);
    expect(event.status).toBe("registration");
    expect(event.eventType).toBe("regular");
    expect(event.prizes).toBe(DEFAULT_PRIZES);
  });

  it("lets options override any field", () => {
    const event = createTournamentEvent(
      "Champs",
      "standard",
      "championship",
      "me",
      { totalRounds: 7, status: "active" },
    );
    expect(event.totalRounds).toBe(7);
    expect(event.status).toBe("active");
    expect(event.eventType).toBe("championship");
  });
});

describe("startTournament / startEvent", () => {
  it("moves a registration event to active round one", () => {
    const event = startTournament(activeEvent({ status: "registration" }));
    expect(event.status).toBe("active");
    expect(event.currentRound).toBe(1);
  });

  it("refuses to start an event that is not in registration", () => {
    expect(() => startTournament(activeEvent())).toThrow(
      /only be started from registration/i,
    );
    expect(() =>
      startTournament(activeEvent({ status: "completed" })),
    ).toThrow();
  });

  it("builds the first Swiss round from the standings", () => {
    const event = startTournament(
      activeEvent({ status: "registration", matches: [] }),
    );
    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].round).toBe(1);
    expect(
      [event.matches[0].player1Id, event.matches[0].player2Id].sort(),
    ).toEqual(["p1", "p2"]);
  });

  it("gives an odd player a self-paired bye", () => {
    const three = activeEvent({
      status: "registration",
      matches: [],
      players: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
        { id: "p3", name: "P3" },
      ],
      standings: [standing("p1"), standing("p2"), standing("p3")],
    });
    const byes = startTournament(three).matches.filter((m) => m.bye);
    expect(byes).toHaveLength(1);
    expect(byes[0].player1Id).toBe(byes[0].player2Id);
  });

  it("startEvent is an alias for startTournament", () => {
    const base = activeEvent({ status: "registration", matches: [] });
    expect(startEvent(base).status).toBe(startTournament(base).status);
  });
});

describe("recordMatchResult", () => {
  it("rejects an unknown match", () => {
    expect(() => recordMatchResult(activeEvent(), "nope", "p1")).toThrow(
      /match not found/i,
    );
  });

  it("rejects a winner who did not play in the match", () => {
    expect(() => recordMatchResult(activeEvent(), "m1", "p9")).toThrow(
      /must be a participant/i,
    );
  });

  it("rejects a non-bye match with only one seat filled", () => {
    const event = activeEvent({
      matches: [match("m1", { player2Id: null })],
    });
    expect(() => recordMatchResult(event, "m1", "p1")).toThrow(
      /must have a loser/i,
    );
  });

  it("awards three match points to the winner and a loss to the loser", () => {
    const after = recordMatchResult(activeEvent(), "m1", "p1");
    expect(byPlayer(after.standings, "p1").wins).toBe(1);
    expect(byPlayer(after.standings, "p1").matchPoints).toBe(3);
    expect(byPlayer(after.standings, "p2").losses).toBe(1);
    expect(byPlayer(after.standings, "p2").matchPoints).toBe(0);
  });

  it("stores the result and optional score on the match", () => {
    const after = recordMatchResult(activeEvent(), "m1", "p2", [2, 1]);
    const played = after.matches.find((m) => m.id === "m1");
    expect(played?.result).toEqual({
      winnerId: "p2",
      loserId: "p1",
      score: [2, 1],
    });
  });

  it("credits a bye as a win with the winner as its own loser", () => {
    const event = activeEvent({
      matches: [match("m1", { player2Id: "p1", bye: true })],
    });
    const after = recordMatchResult(event, "m1", "p1");
    expect(after.matches[0].result).toEqual({
      winnerId: "p1",
      loserId: "p1",
      score: undefined,
    });
    expect(byPlayer(after.standings, "p1").wins).toBe(1);
    expect(byPlayer(after.standings, "p1").matchPoints).toBe(3);
  });

  it("does not mutate the event it was given", () => {
    const before = activeEvent();
    const snapshot = JSON.stringify(before);
    recordMatchResult(before, "m1", "p1");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("re-sorts standings so the leader is first", () => {
    const after = recordMatchResult(activeEvent(), "m1", "p2");
    expect(after.standings[0].playerId).toBe("p2");
  });

  it("recomputes the opponent match-win tiebreaker", () => {
    const after = recordMatchResult(activeEvent(), "m1", "p1");
    // p1's only rated opponent is p2, who is 0-1, so p1's OMW% is 0.
    expect(byPlayer(after.standings, "p1").opponentMatchWinPercentages).toBe(0);
    // p2's only rated opponent is p1, who is 1-0, so p2's OMW% is 1.
    expect(byPlayer(after.standings, "p2").opponentMatchWinPercentages).toBe(1);
    expect(byPlayer(after.standings, "p1").tiebreakers).toHaveLength(3);
  });
});

describe("advanceRound", () => {
  it("refuses to advance an event that is not active", () => {
    expect(() => advanceRound(activeEvent({ status: "registration" }))).toThrow(
      /must be active/i,
    );
  });

  it("completes a Swiss event once the last round is played", () => {
    const after = advanceRound(
      activeEvent({ currentRound: 2, totalRounds: 2 }),
    );
    expect(after.status).toBe("completed");
    expect(after.currentRound).toBe(3);
    expect(typeof after.completedAt).toBe("number");
  });

  it("appends the next Swiss round instead of replacing the played one", () => {
    const after = advanceRound(
      activeEvent({ currentRound: 1, totalRounds: 3 }),
    );
    expect(after.currentRound).toBe(2);
    expect(after.matches.length).toBeGreaterThan(1);
    expect(after.matches.some((m) => m.id === "m1")).toBe(true);
    expect(after.matches.some((m) => m.round === 2)).toBe(true);
    expect(after.status).toBe("active");
  });

  it("refuses to advance a bracket with an undecided match", () => {
    const event = activeEvent({
      format: "single-elimination",
      matches: [
        match("m1"),
        match("m2", { round: 2, player1Id: null, player2Id: null }),
      ],
    });
    expect(() => advanceRound(event)).toThrow(/must be completed/i);
  });

  it("feeds bracket winners into the next round", () => {
    const event = activeEvent({
      format: "single-elimination",
      totalRounds: 2,
      players: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
        { id: "p3", name: "P3" },
        { id: "p4", name: "P4" },
      ],
      matches: [
        match("m1", {
          result: { winnerId: "p1", loserId: "p2" },
        }),
        match("m2", {
          player1Id: "p3",
          player2Id: "p4",
          result: { winnerId: "p3", loserId: "p4" },
        }),
        match("final", { round: 2, player1Id: null, player2Id: null }),
      ],
    });
    const after = advanceRound(event);
    const final = after.matches.find((m) => m.id === "final");
    expect([final?.player1Id, final?.player2Id]).toEqual(["p1", "p3"]);
  });

  it("just bumps the round for a format it does not pair itself", () => {
    const after = advanceRound(
      activeEvent({ format: "double-elimination", currentRound: 1 }),
    );
    expect(after.currentRound).toBe(2);
    expect(after.status).toBe("active");
  });
});

describe("calculateStandings", () => {
  it("orders by match points, highest first", () => {
    const event = activeEvent({
      standings: [
        standing("p1", { matchPoints: 3 }),
        standing("p2", { matchPoints: 9 }),
        standing("p3", { matchPoints: 6 }),
      ],
    });
    expect(calculateStandings(event).map((s) => s.playerId)).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
  });

  it("breaks a tie on the tiebreaker vector, in order", () => {
    const event = activeEvent({
      standings: [
        standing("p1", { matchPoints: 3, tiebreakers: [3, 0.4, 0.5] }),
        standing("p2", { matchPoints: 3, tiebreakers: [3, 0.9, 0.1] }),
      ],
    });
    expect(calculateStandings(event)[0].playerId).toBe("p2");
  });

  it("leaves genuinely equal standings in their existing order", () => {
    const event = activeEvent({
      standings: [standing("p1"), standing("p2")],
    });
    expect(calculateStandings(event).map((s) => s.playerId)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("does not mutate the event's own standings array", () => {
    const event = activeEvent({
      standings: [standing("p1"), standing("p2", { matchPoints: 3 })],
    });
    calculateStandings(event);
    expect(event.standings[0].playerId).toBe("p1");
  });
});

describe("distributePrizes", () => {
  const completed = activeEvent({
    status: "completed",
    standings: [
      standing("p1", { matchPoints: 9 }),
      standing("p2", { matchPoints: 6 }),
      standing("p3", { matchPoints: 3 }),
    ],
  });

  it("refuses to pay out before the event is completed", () => {
    expect(() => distributePrizes(activeEvent(), 100)).toThrow(
      /after tournament is completed/i,
    );
  });

  it("pays the listed positions their percentage of the pool", () => {
    const payouts = distributePrizes(completed, 1000);
    expect(payouts.get("p1")).toBe(300);
    expect(payouts.get("p2")).toBe(200);
    expect(payouts.get("p3")).toBe(120);
  });

  it("splits the unallocated remainder across players below the prize table", () => {
    const event = { ...completed, prizes: [{ position: 1, percentage: 50 }] };
    const payouts = distributePrizes(event, 100);
    expect(payouts.get("p1")).toBe(50);
    // 50% left over, two players outside the table.
    expect(payouts.get("p2")).toBe(25);
    expect(payouts.get("p3")).toBe(25);
  });

  it("pays nobody from an empty pool", () => {
    for (const amount of distributePrizes(completed, 0).values()) {
      expect(amount).toBe(0);
    }
  });

  it("does not invent payees when the table is longer than the field", () => {
    expect(distributePrizes(completed, 1000).size).toBe(3);
  });
});

describe("getMatchForPlayer", () => {
  it("finds the player's match in the current round", () => {
    expect(getMatchForPlayer(activeEvent(), "p2")?.id).toBe("m1");
  });

  it("returns null for a player who is not paired", () => {
    expect(getMatchForPlayer(activeEvent(), "p9")).toBeNull();
  });

  it("ignores matches from other rounds", () => {
    const event = activeEvent({
      currentRound: 2,
      matches: [match("m1", { round: 1 })],
    });
    expect(getMatchForPlayer(event, "p1")).toBeNull();
  });
});

describe("getTournamentChampion", () => {
  it("returns null while the event is still running", () => {
    expect(getTournamentChampion(activeEvent())).toBeNull();
  });

  it("returns the winner of the bracket's final match", () => {
    const event = activeEvent({
      status: "completed",
      format: "single-elimination",
      matches: [
        match("m1"),
        match("final", {
          round: 2,
          result: { winnerId: "p2", loserId: "p1" },
        }),
      ],
    });
    expect(getTournamentChampion(event)?.id).toBe("p2");
  });

  it("falls back to the top of the standings for Swiss", () => {
    const event = activeEvent({
      status: "completed",
      standings: [standing("p2", { matchPoints: 9 }), standing("p1")],
    });
    expect(getTournamentChampion(event)?.id).toBe("p2");
  });

  it("returns null when there is nobody to crown", () => {
    expect(
      getTournamentChampion(
        activeEvent({ status: "completed", standings: [], players: [] }),
      ),
    ).toBeNull();
  });
});

describe("registration", () => {
  const empty = activeEvent({
    status: "registration",
    players: [],
    standings: [],
    matches: [],
  });

  it("adds a player and an empty standing together", () => {
    const after = registerPlayer(empty, "p7", "Nina");
    expect(after.players).toEqual([{ id: "p7", name: "Nina" }]);
    expect(after.standings[0]).toMatchObject({
      playerId: "p7",
      name: "Nina",
      wins: 0,
      matchPoints: 0,
    });
  });

  it("refuses a duplicate registration", () => {
    expect(() => registerPlayer(activeEvent(), "p1", "P1")).toThrow(
      /already registered/i,
    );
  });

  it("removes both the player and the standing on unregister", () => {
    const after = unregisterPlayer(activeEvent(), "p1");
    expect(after.players.map((p) => p.id)).toEqual(["p2"]);
    expect(after.standings.map((s) => s.playerId)).toEqual(["p2"]);
  });

  it("is a no-op when unregistering someone who never joined", () => {
    const before = activeEvent();
    const after = unregisterPlayer(before, "p9");
    expect(after.players).toHaveLength(before.players.length);
  });

  it("opens registration only for an event already in registration", () => {
    expect(
      openRegistration(activeEvent({ status: "registration" })).status,
    ).toBe("registration");
    expect(() => openRegistration(activeEvent())).toThrow(
      /only open registration/i,
    );
  });
});

describe("completeEvent / cancelEvent", () => {
  const finalStandings: EventStandings[] = [
    { ...standing("p1", { wins: 2, matchPoints: 6 }), placement: 1 },
    { ...standing("p2", { losses: 2 }), placement: 2 },
  ];

  it("stamps a completion time and keeps the supplied standings", () => {
    const after = completeEvent(activeEvent(), finalStandings);
    expect(after.status).toBe("completed");
    expect(typeof after.completedAt).toBe("number");
    expect(after.standings.map((s) => s.playerId)).toEqual(["p1", "p2"]);
    expect(after.standings[0].matchPoints).toBe(6);
  });

  it("drops the placement field, which is not part of a Standing", () => {
    const after = completeEvent(activeEvent(), finalStandings);
    expect(after.standings[0]).not.toHaveProperty("placement");
  });

  it("cancelling also lands on completed, leaving standings untouched", () => {
    const before = activeEvent();
    const after = cancelEvent(before);
    expect(after.status).toBe("completed");
    expect(typeof after.completedAt).toBe("number");
    expect(after.standings).toEqual(before.standings);
  });
});

describe("event history", () => {
  function entry(over: Partial<EventHistory> = {}): EventHistory {
    return {
      id: "h",
      name: "Old",
      format: "standard",
      eventType: "regular",
      result: "9th+",
      date: 1,
      ...over,
    };
  }

  it("puts the newest event first", () => {
    const history = addToEventHistory([entry()], activeEvent(), "1st");
    expect(history).toHaveLength(2);
    expect(history[0].name).toBe("Friday Night Standard");
    expect(history[0].result).toBe("1st");
  });

  it("caps the history at 100 entries", () => {
    const full = Array.from({ length: 100 }, (_, i) => entry({ id: `h${i}` }));
    const history = addToEventHistory(full, activeEvent(), "dnf");
    expect(history).toHaveLength(100);
    expect(history[0].result).toBe("dnf");
    expect(history.some((h) => h.id === "h99")).toBe(false);
  });

  it("defaults the event type to regular", () => {
    expect(addToEventHistory([], activeEvent(), "2nd")[0].eventType).toBe(
      "regular",
    );
    const champs = activeEvent({ eventType: "championship" });
    expect(addToEventHistory([], champs, "2nd")[0].eventType).toBe(
      "championship",
    );
  });

  it("records no placement when there are no standings", () => {
    const empty = activeEvent({ standings: [] });
    expect(addToEventHistory([], empty, "dnf")[0].placement).toBeUndefined();
  });

  it("derives placement from the first standing, so it is always 1", () => {
    // Quirk, not a bug fix: the module reads standings[0] and then asks for
    // its index, which is 0 by construction. Pinned so a real placement
    // calculation shows up as a deliberate change here.
    expect(addToEventHistory([], activeEvent(), "1st")[0].placement).toBe(1);
  });
});

describe("getTotalPrizes", () => {
  it("counts an empty history as zero", () => {
    expect(getTotalPrizes([])).toEqual({ points: 0, events: 0 });
  });

  it("scores each finish band and counts every event", () => {
    const history: EventHistory[] = (
      ["1st", "2nd", "3rd-8th", "9th+", "dnf"] as const
    ).map((result, i) => ({
      id: `h${i}`,
      name: `E${i}`,
      format: "standard",
      eventType: "regular",
      result,
      date: i,
    }));
    // 30 + 20 + 8 + 2 + 0 (a dnf scores nothing).
    expect(getTotalPrizes(history)).toEqual({ points: 60, events: 5 });
  });
});
