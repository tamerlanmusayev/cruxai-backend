/** Map raw provider/internal errors to a clean, user-facing message. */
export function friendlyError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('credit balance') || s.includes('billing') || s.includes('quota')) {
    return 'AI is temporarily unavailable (service capacity). Please try again later.';
  }
  if (s.includes('401') || s.includes('authentication') || s.includes('api key')) {
    return 'AI service is not configured right now. Please try again later.';
  }
  if (s.includes('429') || s.includes('rate limit') || s.includes('overloaded')) {
    return 'The AI is busy right now — please try again in a minute.';
  }
  if (s.startsWith('4') && s.includes('{')) {
    // Any other raw HTTP/JSON provider error — don't leak internals.
    return 'Something went wrong while processing this document. Please try again.';
  }
  // Our own validation messages (page limit, scanned, etc.) are already friendly.
  return raw.slice(0, 300);
}
