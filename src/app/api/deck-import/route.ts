import { NextRequest, NextResponse } from "next/server";

/**
 * Supported deck hosting sites
 */
interface SupportedSite {
  name: string;
  domain: string;
  parseDecklist?: (html: string) => string | null;
  fetchDecklist?: (url: string) => Promise<string | null>;
}

const SUPPORTED_SITES: SupportedSite[] = [
  {
    name: "MTGGoldfish",
    domain: "mtggoldfish.com",
    parseDecklist: (html: string): string | null => {
      // MTGGoldfish typically has decklist in a textarea or script tag
      const textareaMatch = html.match(
        /<textarea[^>]*id="decklist"[^>]*>([\s\S]*?)<\/textarea>/i,
      );
      if (textareaMatch) {
        return textareaMatch[1].trim();
      }

      // Alternative: look for decklist in a script tag as JSON
      const scriptMatch = html.match(
        /deck\s*=\s*({[\s\S]*?"mainboard"[\s\S]*?});/i,
      );
      if (scriptMatch) {
        try {
          const deck = JSON.parse(scriptMatch[1]);
          const allCards: string[] = [];

          if (deck.mainboard) {
            Object.entries(deck.mainboard).forEach(
              ([name, quantity]: [string, any]) => {
                allCards.push(`${quantity} ${name}`);
              },
            );
          }

          if (deck.sideboard) {
            Object.entries(deck.sideboard).forEach(
              ([name, quantity]: [string, any]) => {
                allCards.push(`${quantity} ${name}`);
              },
            );
          }

          if (allCards.length > 0) {
            return allCards.join("\n");
          }
        } catch {
          // Failed to parse
        }
      }

      return null;
    },
  },
  {
    name: "TappedOut",
    domain: "tappedout.net",
    parseDecklist: (html: string): string | null => {
      // TappedOut typically has decklist in a pre tag or similar
      const preMatch = html.match(
        /<pre[^>]*class="[^"]*deck-list[^"]*"[^>]*>([\s\S]*?)<\/pre>/i,
      );
      if (preMatch) {
        return preMatch[1].replace(/<[^>]+>/g, "").trim();
      }

      // Alternative: look for mtg-parser-info div
      const divMatch = html.match(
        /<div[^>]*class="[^"]*mtg-parser-info[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
      if (divMatch) {
        const lines = divMatch[1]
          .replace(/<[^>]+>/g, "")
          .split("\n")
          .filter((line) => line.trim());
        return lines.join("\n");
      }

      return null;
    },
  },
  {
    name: "Moxfield",
    domain: "moxfield.com",
    parseDecklist: (html: string): string | null => {
      // Moxfield has deck data in a script tag as JSON (legacy SSR)
      const scriptMatch = html.match(
        /window\["__INITIAL_STATE__"\]=([\s\S]*?);/i,
      );
      if (scriptMatch) {
        try {
          const data = JSON.parse(scriptMatch[1]);
          // Different versions of Moxfield state can have data in different places
          const deckData = data?.publicDecklist || data?.deck;

          if (deckData?.boards) {
            const allCards: string[] = [];
            const boards = deckData.boards;

            // Process all boards except maybeboard
            for (const boardName of Object.keys(boards)) {
              if (boardName === "maybeboard") continue;

              const entries = boards[boardName]?.entries;
              if (entries) {
                Object.values(entries).forEach((cardData: any) => {
                  if (cardData?.quantity && cardData?.card?.name) {
                    allCards.push(`${cardData.quantity} ${cardData.card.name}`);
                  }
                });
              }
            }

            if (allCards.length > 0) {
              return allCards.join("\n");
            }
          }
        } catch {
          // Failed to parse
        }
      }
      return null;
    },
    fetchDecklist: async (url: string): Promise<string | null> => {
      // Extract public ID from URL
      const match = url.match(/\/decks\/([^/?#]+)/);
      if (!match) return null;

      const publicId = match[1];
      const apiUrl = `https://api2.moxfield.com/v2/decks/all/${publicId}`;

      // Try fetching via CORS proxy
      const proxyUrls = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`,
      ];

      for (const proxyUrl of proxyUrls) {
        try {
          const response = await fetch(proxyUrl, {
            headers: { Accept: "application/json" },
          });

          if (!response.ok) continue;

          const text = await response.text();
          let jsonText = text;

          // allorigins /get wraps response in JSON
          if (proxyUrl.includes("/get?")) {
            try {
              const wrapped = JSON.parse(text);
              if (wrapped.contents) jsonText = wrapped.contents;
            } catch {
              // Not wrapped, use raw text
            }
          }

          const deck = JSON.parse(jsonText);
          if (!deck) continue;

          const allCards: string[] = [];
          const boardNames = [
            "mainboard",
            "sideboard",
            "commanders",
            "companions",
            "attractions",
            "stickers",
            "contraptions",
            "planes",
            "schemes",
          ];

          for (const boardName of boardNames) {
            const board = (deck as any)[boardName];
            if (!board || typeof board !== "object") continue;

            for (const entry of Object.values(board)) {
              const cardEntry = entry as any;
              if (cardEntry?.quantity && cardEntry?.card?.name) {
                allCards.push(`${cardEntry.quantity} ${cardEntry.card.name}`);
              }
            }
          }

          if (allCards.length > 0) {
            return allCards.join("\n");
          }
        } catch {
          // Try next proxy
        }
      }

      return null;
    },
  },
];

/**
 * Detect which site the URL is from and parse the decklist
 */
function detectAndParseSite(
  url: string,
  html: string,
): { decklist: string | null; siteName: string } | null {
  for (const site of SUPPORTED_SITES) {
    if (url.includes(site.domain)) {
      const decklist = site.parseDecklist ? site.parseDecklist(html) : null;
      return { decklist, siteName: site.name };
    }
  }
  return null;
}

/**
 * Validate that the decklist has at least some cards
 */
function validateDecklist(decklist: string): {
  valid: boolean;
  error?: string;
  cardCount?: number;
} {
  if (!decklist || decklist.trim().length === 0) {
    return { valid: false, error: "No decklist found on the page" };
  }

  // Count potential card lines
  const lines = decklist.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    return { valid: false, error: "No valid card entries found in decklist" };
  }

  return { valid: true, cardCount: lines.length };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    // Validate URL
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 },
      );
    }

    // Check if URL is from a supported site
    const supportedSite = SUPPORTED_SITES.find((site) =>
      parsedUrl.hostname.includes(site.domain),
    );
    if (!supportedSite) {
      return NextResponse.json(
        {
          error: "Unsupported website",
          supportedSites: SUPPORTED_SITES.map((s) => s.name),
        },
        { status: 400 },
      );
    }

    let decklist: string | null = null;

    // Try site-specific API fetch first (e.g., Moxfield v2 API)
    if (supportedSite.fetchDecklist) {
      try {
        decklist = await supportedSite.fetchDecklist(url);
      } catch (error) {
        console.error(
          `Site-specific fetch failed for ${supportedSite.name}:`,
          error,
        );
      }
    }

    // Fall back to generic HTML scraping
    if (!decklist) {
      // Fetch the URL using a CORS proxy approach (server-side)
      // Using a public CORS proxy for development, in production you'd want your own proxy
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

      const response = await fetch(proxyUrl, {
        headers: {
          Accept: "text/html",
        },
      });

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch deck URL: ${response.status} ${response.statusText}`,
            suggestion:
              "Try exporting the decklist as text from the site and using the Text/Clipboard import option instead.",
          },
          { status: response.status },
        );
      }

      const html = await response.text();

      // Parse the decklist from the HTML
      const result = detectAndParseSite(url, html);

      if (result) {
        decklist = result.decklist;
      }
    }

    if (!decklist) {
      return NextResponse.json(
        {
          error: "Could not parse decklist from this URL",
          siteName: supportedSite.name,
          suggestion:
            "Try exporting the decklist as text from the site and using the Text/Clipboard import option instead.",
        },
        { status: 422 },
      );
    }

    // Validate the parsed decklist
    const validation = validateDecklist(decklist);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      decklist,
      siteName: supportedSite.name,
      cardCount: validation.cardCount,
    });
  } catch (error) {
    console.error("Error in deck-import API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
