import { logger } from './logger.js';

const rateLimitStore = new Map();
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();

/** Supprime les entrées périmées sans timer persistant (appelé au plus une fois/minute). */
function sweepExpiredEntries(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > (entry.windowMs ?? SWEEP_INTERVAL_MS)) {
      rateLimitStore.delete(key);
    }
  }
}








export async function checkRateLimit(key, maxAttempts = 5, windowMs = 60000) {
  try {
    const now = Date.now();
    sweepExpiredEntries(now);
    const entry = rateLimitStore.get(key);

    
    if (!entry || now - entry.windowStart > windowMs) {
      rateLimitStore.set(key, {
        count: 1,
        windowStart: now,
        windowMs
      });
      return true;
    }

    
    if (entry.count < maxAttempts) {
      entry.count++;
      return true;
    }

    
    logger.debug(`Rate limit exceeded for ${key}`);
    return false;
  } catch (error) {
    logger.error('Error checking rate limit:', error);
    return true; 
  }
}







export function getRateLimitStatus(key, windowMs = 60000) {
  const entry = rateLimitStore.get(key);
  if (!entry) {
    return { limited: false, remaining: windowMs };
  }

  const elapsed = Date.now() - entry.windowStart;
  const remaining = Math.max(0, windowMs - elapsed);

  return {
    limited: remaining > 0,
    remaining,
    attempts: entry.count
  };
}





export function clearRateLimit(key) {
  rateLimitStore.delete(key);
}




export function clearAllRateLimits() {
  rateLimitStore.clear();
  logger.info('All rate limits cleared');
}
