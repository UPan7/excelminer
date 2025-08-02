import { supabase } from '@/integrations/supabase/client';
import type { CreateAuditLogParams, AuditActionType } from '@/types/audit';

class AuditLogger {
  private async getClientInfo() {
    // Get current session to derive a stable session_id
    const { data: { session } } = await supabase.auth.getSession();
    
    // Use session access token to create consistent session_id
    // If no session, fallback to random ID
    const session_id = session?.access_token 
      ? session.access_token.slice(-9) // Last 9 chars of access token
      : Math.random().toString(36).substr(2, 9);
    
    return {
      ip_address: null, // IP is handled server-side
      user_agent: navigator.userAgent,
      session_id
    };
  }

  async log(params: CreateAuditLogParams): Promise<void> {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.warn('Failed to get user for audit log:', authError);
      }

      const clientInfo = await this.getClientInfo();
      
      const auditData = {
        user_id: user?.id || null,
        action_type: params.action_type,
        resource_type: params.resource_type || null,
        resource_id: params.resource_id || null,
        details: params.details || {},
        status: params.status || 'success',
        error_message: params.error_message || null,
        ...clientInfo
      };

      const { error } = await supabase
        .from('audit_logs')
        .insert(auditData);

      if (error) {
        console.error('Failed to write audit log:', error);
        // Fallback to console logging
        console.log('AUDIT:', auditData);
      }
    } catch (error) {
      console.error('Audit logging error:', error);
      // Fallback to console logging
      console.log('AUDIT:', params);
    }
  }

  // Convenience methods for common audit events
  async logUserLogin(userId: string, details?: Record<string, any>) {
    await this.log({
      action_type: 'user_login',
      resource_type: 'user',
      resource_id: userId,
      details: { ...details, timestamp: new Date().toISOString() }
    });
  }

  async logUserLogout(userId: string) {
    await this.log({
      action_type: 'user_logout',
      resource_type: 'user',
      resource_id: userId
    });
  }

  async logLoginFailure(email?: string, reason?: string) {
    await this.log({
      action_type: 'user_login_failed',
      resource_type: 'user',
      details: { email, reason },
      status: 'failure',
      error_message: reason
    });
  }

  async logFileUpload(fileName: string, fileSize: number, details?: Record<string, any>) {
    await this.log({
      action_type: 'file_uploaded',
      resource_type: 'file',
      resource_id: fileName,
      details: { fileName, fileSize, ...details }
    });
  }

  async logComparison(comparisonId: string, details: Record<string, any>) {
    await this.log({
      action_type: 'comparison_performed',
      resource_type: 'comparison',
      resource_id: comparisonId,
      details
    });
  }

  async logRoleChange(targetUserId: string, oldRole: string, newRole: string, adminUserId: string) {
    await this.log({
      action_type: 'user_role_changed',
      resource_type: 'user',
      resource_id: targetUserId,
      details: { oldRole, newRole, adminUserId, timestamp: new Date().toISOString() }
    });
  }

  async logUserInvitation(email: string, role: string) {
    await this.log({
      action_type: 'user_invited',
      resource_type: 'user',
      details: { email, role }
    });
  }

  async logUserDeletion(email: string, adminUserId: string) {
    await this.log({
      action_type: 'user_deleted',
      resource_type: 'user',
      details: { email, adminUserId, timestamp: new Date().toISOString() }
    });
  }

  async logSecurityEvent(eventType: string, details: Record<string, any>) {
    await this.log({
      action_type: 'security_event',
      details: { eventType, ...details },
      status: 'warning'
    });
  }
}

export const auditLogger = new AuditLogger();