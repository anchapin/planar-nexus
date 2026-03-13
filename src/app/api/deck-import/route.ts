import { NextRequest, NextResponse } from 'next/server';

/**
 * Supported deck hosting sites
 */
const SUPPORTED_SITES = [
  { 
    name: 'MTGGoldfish', 
    domain: 'mtggoldfish.com',
    deckListSelector: '#decklists-display textarea',
    parseDecklist: (html: string): string | null => {
      // MTGGoldfish typically has decklist in a textarea or script tag
      const textareaMatch = html.match(/<textarea[^>]*id="decklist"[^>]*>([\s\S]*?)<\/textarea>/i);
      if (textareaMatch) {
        return textareaMatch[1].trim();
      }
      
      // Alternative: look for decklist in a script tag as JSON
      const scriptMatch = html.match(/deck\s*=\s*({[\s\S]*?"mainboard"[\s\S]*?});/i);
      if (scriptMatch) {
        try {
          const deck = JSON.parse(scriptMatch[1]);
          if (deck.mainboard) {
            return Object.entries(deck.mainboard)
              .map(([name, quantity]: [string, any]) => `${quantity} ${name}`)
              .join('\n');
          }
        } catch {
          // Failed to parse
        }
      }
      
      return null;
    }
  },
  { 
    name: 'TappedOut', 
    domain: 'tappedout.net',
    parseDecklist: (html: string): string | null => {
      // TappedOut typically has decklist in a pre tag or similar
      const preMatch = html.match(/<pre[^>]*class="[^"]*deck-list[^"]*"[^>]*>([\s\S]*?)<\/pre>/i);
      if (preMatch) {
        return preMatch[1].replace(/<[^>]+>/g, '').trim();
      }
      
      // Alternative: look for mtg-parser-info div
      const divMatch = html.match(/<div[^>]*class="[^"]*mtg-parser-info[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (divMatch) {
        const lines = divMatch[1]
          .replace(/<[^>]+>/g, '')
          .split('\n')
          .filter(line => line.trim());
        return lines.join('\n');
      }
      
      return null;
    }
  },
  { 
    name: 'Moxfield', 
    domain: 'moxfield.com',
    parseDecklist: (html: string): string | null => {
      // Moxfield has deck data in a script tag as JSON
      const scriptMatch = html.match(/window\["__INITIAL_STATE__"\]=([\s\S]*?);/i);
      if (scriptMatch) {
        try {
          const data = JSON.parse(scriptMatch[1]);
          if (data?.publicDecklist?.boards?.mainboard?.entries) {
            return Object.entries(data.publicDecklist.boards.mainboard.entries)
              .map(([cardId, cardData]: [string, any]) => `${cardData.quantity} ${cardData.card.name}`)
              .join('\n');
          }
        } catch {
          // Failed to parse
        }
      }
      return null;
    }
  },
];

/**
 * Detect which site the URL is from and parse the decklist
 */
function detectAndParseSite(url: string, html: string): { decklist: string | null; siteName: string } | null {
  for (const site of SUPPORTED_SITES) {
    if (url.includes(site.domain)) {
      const decklist = site.parseDecklist(html);
      return { decklist, siteName: site.name };
    }
  }
  return null;
}

/**
 * Validate that the decklist has at least some cards
 */
function validateDecklist(decklist: string): { valid: boolean; error?: string; cardCount?: number } {
  if (!decklist || decklist.trim().length === 0) {
    return { valid: false, error: 'No decklist found on the page' };
  }
  
  // Count potential card lines
  const lines = decklist.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    return { valid: false, error: 'No valid card entries found in decklist' };
  }
  
  return { valid: true, cardCount: lines.length };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Check if URL is from a supported site
    const supportedSite = SUPPORTED_SITES.find(site => parsedUrl.hostname.includes(site.domain));
    if (!supportedSite) {
      return NextResponse.json(
        { 
          error: 'Unsupported website',
          supportedSites: SUPPORTED_SITES.map(s => s.name)
        },
        { status: 400 }
      );
    }

    // Fetch the URL using a CORS proxy approach (server-side)
    // Using a public CORS proxy for development, in production you'd want your own proxy
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl, {
      headers: {
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch deck URL: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const html = await response.text();

    // Parse the decklist from the HTML
    const result = detectAndParseSite(url, html);
    
    if (!result || !result.decklist) {
      return NextResponse.json(
        { 
          error: 'Could not parse decklist from this URL',
          siteName: result?.siteName,
          suggestions: 'The deck might be private or the page structure may have changed'
        },
        { status: 422 }
      );
    }

    // Validate the parsed decklist
    const validation = validateDecklist(result.decklist);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      decklist: result.decklist,
      siteName: result.siteName,
      cardCount: validation.cardCount,
    });

  } catch (error) {
    console.error('Error in deck-import API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
