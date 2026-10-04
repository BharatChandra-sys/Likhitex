/**
 * Simple SyncTeX parser for PDF-to-source navigation.
 * 
 * SyncTeX maps PDF coordinates to source locations.
 * This parser extracts line mappings from the .synctex.gz file.
 */

import * as pako from 'pako';

interface SyncTeXMapping {
  page: number;
  line: number;
  column: number;
  x: number;
  y: number;
  h: number;
  w: number;
}

/**
 * Parse SyncTeX data and extract page-to-line mappings.
 */
export function parseSyncTeX(base64Data: string): SyncTeXMapping[] {
  try {
    // Decode base64
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Decompress gzip
    const decompressed = pako.ungzip(bytes);
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(decompressed);
    
    const mappings: SyncTeXMapping[] = [];
    const lines = text.split('\n');
    
    let currentPage = 1;
    let currentX = 0;
    let currentY = 0;
    let currentH = 0;
    let currentW = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Page marker: [1 or [2, etc.
      if (trimmed.match(/^\[(\d+)/)) {
        const match = trimmed.match(/^\[(\d+)/);
        if (match) currentPage = parseInt(match[1], 10);
      }
      
      // Vertical position: v123456
      else if (trimmed.match(/^v(-?\d+)/)) {
        const match = trimmed.match(/^v(-?\d+)/);
        if (match) currentY = parseInt(match[1], 10);
      }
      
      // Horizontal position with line info: h123456:45,12
      else if (trimmed.match(/^h(-?\d+):(\d+),(\d+)/)) {
        const match = trimmed.match(/^h(-?\d+):(\d+),(\d+)/);
        if (match) {
          currentX = parseInt(match[1], 10);
          const lineNum = parseInt(match[2], 10);
          const colNum = parseInt(match[3], 10);
          
          if (lineNum > 0) {
            mappings.push({
              page: currentPage,
              line: lineNum,
              column: colNum,
              x: currentX / 65536, // SyncTeX uses scaled points
              y: currentY / 65536,
              h: currentH / 65536,
              w: currentW / 65536,
            });
          }
        }
      }
      
      // Box dimensions: $123,456
      else if (trimmed.match(/^\$(-?\d+),(-?\d+)/)) {
        const match = trimmed.match(/^\$(-?\d+),(-?\d+)/);
        if (match) {
          currentH = parseInt(match[1], 10);
          currentW = parseInt(match[2], 10);
        }
      }
    }
    
    return mappings;
  } catch (err) {
    console.error('Failed to parse SyncTeX:', err);
    return [];
  }
}

/**
 * Find the source line for a PDF click position.
 * Returns the closest mapping to the click coordinates.
 */
export function findLineFromClick(
  mappings: SyncTeXMapping[],
  page: number,
  x: number,
  y: number
): number | null {
  const pageMappings = mappings.filter((m) => m.page === page);
  if (pageMappings.length === 0) return null;
  
  // Find closest mapping by Euclidean distance
  let closest = pageMappings[0];
  let minDistance = Infinity;
  
  for (const mapping of pageMappings) {
    const dx = mapping.x - x;
    const dy = mapping.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < minDistance) {
      minDistance = distance;
      closest = mapping;
    }
  }
  
  return closest.line;
}
