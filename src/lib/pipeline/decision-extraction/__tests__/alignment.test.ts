import {
  alignTranscriptToFrame,
  buildTranscriptText,
  detectDecisionMoments,
} from "../alignment";

describe("alignTranscriptToFrame", () => {
  const segments = [
    { start_ms: 10000, end_ms: 12000, text: "First segment", confidence: 0.9 },
    { start_ms: 20000, end_ms: 22000, text: "Second segment", confidence: 0.8 },
    { start_ms: 30000, end_ms: 32000, text: "Third segment", confidence: 0.7 },
  ];

  it("returns matching segments within the window", () => {
    const alignment = alignTranscriptToFrame(15000, segments, 5000);
    expect(alignment.transcript_segments).toHaveLength(1);
    expect(alignment.transcript_segments[0].text).toBe("First segment");
    expect(alignment.window_start_ms).toBe(10000);
    expect(alignment.window_end_ms).toBe(20000);
  });

  it("returns empty when no segments match", () => {
    const alignment = alignTranscriptToFrame(50000, segments, 5000);
    expect(alignment.transcript_segments).toHaveLength(0);
  });

  it("uses default window radius of 15s", () => {
    const alignment = alignTranscriptToFrame(20000, segments);
    expect(alignment.transcript_segments).toHaveLength(3);
    expect(alignment.window_start_ms).toBe(5000);
    expect(alignment.window_end_ms).toBe(35000);
  });

  it("sorts segments by start time", () => {
    const unsorted = [segments[2], segments[0], segments[1]];
    const alignment = alignTranscriptToFrame(20000, unsorted, 20000);
    const starts = alignment.transcript_segments.map((s) => s.start_ms);
    expect(starts).toEqual([10000, 20000, 30000]);
  });
});

describe("buildTranscriptText", () => {
  it("formats segments with timestamps", () => {
    const alignment = {
      frame_timestamp_ms: 15000,
      transcript_segments: [
        { start_ms: 10000, end_ms: 12000, text: "Hello", confidence: 0.9 },
        { start_ms: 13000, end_ms: 15000, text: "World", confidence: 0.8 },
      ],
      window_start_ms: 5000,
      window_end_ms: 25000,
    };
    const text = buildTranscriptText(alignment);
    expect(text).toContain("[00:10.000] Hello");
    expect(text).toContain("[00:13.000] World");
  });

  it("returns empty string for no segments", () => {
    const alignment = {
      frame_timestamp_ms: 15000,
      transcript_segments: [],
      window_start_ms: 5000,
      window_end_ms: 25000,
    };
    expect(buildTranscriptText(alignment)).toBe("");
  });
});

describe("detectDecisionMoments", () => {
  it("detects spell cast from keyword", () => {
    const text = "He casts Lightning Bolt targeting the opponent";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("spell_cast");
  });

  it("detects attack declaration", () => {
    const text = "He attacks with his Tarmogoyf";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("attack_declaration");
  });

  it("detects block declaration", () => {
    const text = "She blocks with her Snapcaster Mage";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("block_declaration");
  });

  it("detects mulligan", () => {
    const text = "He decides to mulligan to six";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("mulligan");
  });

  it("detects ability activation", () => {
    const text = "He activates his planeswalker ability";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("ability_activation");
  });

  it("returns empty for non-decision text", () => {
    const text = "Welcome to the stream everyone!";
    const moments = detectDecisionMoments(text);
    expect(moments).toHaveLength(0);
  });

  it("deduplicates moment types", () => {
    const text = "He attacks with his creatures, attacks going wide";
    const moments = detectDecisionMoments(text);
    expect(moments.filter((m) => m === "attack_declaration")).toHaveLength(1);
  });

  it("detects multiple moment types", () => {
    const text =
      "He attacks with his creature and then activates an ability in response";
    const moments = detectDecisionMoments(text);
    expect(moments).toContain("attack_declaration");
    expect(moments).toContain("ability_activation");
  });
});
