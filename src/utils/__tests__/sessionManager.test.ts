import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the supabase client
const mockSignOut = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signOut: mockSignOut
    }
  }
}));

// Import after mocking
import { SessionManager } from '../sessionManager';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    originalDateNow = Date.now;
    mockSignOut.mockClear();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    Date.now = originalDateNow;
    sessionManager?.destroy();
    vi.useRealTimers();
  });

  it('should return zero remaining time for expired sessions', () => {
    const mockTime = 1000000;
    Date.now = vi.fn(() => mockTime);
    
    sessionManager = new SessionManager();
    
    // Simulate time passing beyond the session timeout (8 hours = 28800000 ms)
    Date.now = vi.fn(() => mockTime + 28800000 + 1000); // 1 second past timeout
    
    const remainingTime = sessionManager.getTimeUntilExpiry();
    expect(remainingTime).toBe(0);
  });

  it('should return positive remaining time for active sessions', () => {
    const mockTime = 1000000;
    Date.now = vi.fn(() => mockTime);
    
    sessionManager = new SessionManager();
    
    // Simulate 1 hour passing (3600000 ms)
    Date.now = vi.fn(() => mockTime + 3600000);
    
    const remainingTime = sessionManager.getTimeUntilExpiry();
    expect(remainingTime).toBeGreaterThan(0);
    expect(remainingTime).toBe(28800000 - 3600000); // 7 hours remaining
  });

  it('should reset activity when resetActivity is called', () => {
    const mockTime = 1000000;
    Date.now = vi.fn(() => mockTime);
    
    sessionManager = new SessionManager();
    
    // Simulate time passing
    Date.now = vi.fn(() => mockTime + 3600000); // 1 hour later
    
    // Reset activity
    sessionManager.resetActivity();
    
    const remainingTime = sessionManager.getTimeUntilExpiry();
    expect(remainingTime).toBe(28800000); // Full 8 hours remaining
  });
});