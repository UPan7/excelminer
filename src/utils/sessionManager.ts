import { supabase } from '@/integrations/supabase/client';

const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
const ACTIVITY_CHECK_INTERVAL = 60 * 1000; // Check every minute

class SessionManager {
  private activityTimer: NodeJS.Timeout | null = null;
  private lastActivity: number = Date.now();

  constructor() {
    this.setupActivityListeners();
    this.startActivityCheck();
  }

  private setupActivityListeners() {
    const updateActivity = () => {
      this.lastActivity = Date.now();
    };

    // Listen for user activity
    document.addEventListener('mousedown', updateActivity);
    document.addEventListener('mousemove', updateActivity);
    document.addEventListener('keypress', updateActivity);
    document.addEventListener('scroll', updateActivity);
    document.addEventListener('touchstart', updateActivity);
  }

  private startActivityCheck() {
    this.activityTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastActivity;

      if (timeSinceLastActivity > SESSION_TIMEOUT) {
        this.expireSession();
      }
    }, ACTIVITY_CHECK_INTERVAL);
  }

  private async expireSession() {
    try {
      console.log('Session expired due to inactivity');
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error during session expiration:', error);
    }
  }

  public resetActivity() {
    this.lastActivity = Date.now();
  }

  public getTimeUntilExpiry(): number {
    return SESSION_TIMEOUT - (Date.now() - this.lastActivity);
  }

  public destroy() {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
    }
  }
}

export const sessionManager = new SessionManager();