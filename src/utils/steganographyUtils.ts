/**
 * Steganography Utilities for Turwin IP Watermarking
 * 
 * Implements Zero-Width Character (ZWC) encoding to hide
 * cryptographic provenance IDs inside plain text recipes.
 */

// Zero-width characters used for binary encoding
const ZERO_WIDTH_SPACE = '\u200B';       // Represents binary 0
const ZERO_WIDTH_NON_JOINER = '\u200C';  // Represents binary 1
const ZERO_WIDTH_JOINER = '\u200D';      // Start/End delimiter

/**
 * Encodes a string (e.g., "Turwin-Gen-ID: 1234") into invisible characters
 */
export function encodeSteganography(hiddenText: string): string {
  const binary = textToBinary(hiddenText);
  let hidden = ZERO_WIDTH_JOINER; // Start marker
  
  for (let i = 0; i < binary.length; i++) {
    hidden += binary[i] === '0' ? ZERO_WIDTH_SPACE : ZERO_WIDTH_NON_JOINER;
  }
  
  hidden += ZERO_WIDTH_JOINER; // End marker
  return hidden;
}

/**
 * Decodes the invisible characters back into the original ID
 */
export function decodeSteganography(scrambledText: string): string | null {
  // Regex to extract the specialized zero-width sequence
  const pattern = new RegExp(`${ZERO_WIDTH_JOINER}([${ZERO_WIDTH_SPACE}${ZERO_WIDTH_NON_JOINER}]+)${ZERO_WIDTH_JOINER}`);
  const match = scrambledText.match(pattern);
  
  if (!match) return null;
  
  const hiddenBinary = match[1];
  let binaryString = '';
  
  for (let char of hiddenBinary) {
    if (char === ZERO_WIDTH_SPACE) binaryString += '0';
    else if (char === ZERO_WIDTH_NON_JOINER) binaryString += '1';
  }
  
  return binaryToText(binaryString);
}


// --- Helpers ---

function textToBinary(text: string): string {
  return text.split('').map(char => {
    return char.charCodeAt(0).toString(2).padStart(8, '0');
  }).join('');
}

function binaryToText(binary: string): string {
  const bytes = binary.match(/.{1,8}/g) || [];
  return bytes.map(byte => String.fromCharCode(parseInt(byte, 2))).join('');
}

/**
 * Generates a unique traceable ID for a new recipe
 */
export function generateTurwinID(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TURWIN-${timestamp}-${random}`;
}
