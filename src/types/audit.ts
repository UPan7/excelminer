export interface AuditLog {
  id: string;
  timestamp: string;
  user_id?: string | null;
  session_id?: string | null;
  action_type: string;
  resource_type?: string | null;
  resource_id?: string | null;
  ip_address?: unknown;
  user_agent?: string | null;
  details: unknown;
  status: string;
  error_message?: string | null;
  created_at: string;
}

export interface CreateAuditLogParams {
  action_type: string;
  resource_type?: string;
  resource_id?: string;
  details?: unknown;
  status?: 'success' | 'failure' | 'warning';
  error_message?: string;
}

export type AuditActionType = 
  | 'user_login'
  | 'user_logout'
  | 'user_login_failed'
  | 'user_invited'
  | 'user_role_changed'
  | 'file_uploaded'
  | 'file_validated'
  | 'comparison_performed'
  | 'profile_updated'
  | 'admin_action'
  | 'security_event';

export type AuditResourceType = 
  | 'user'
  | 'file'
  | 'comparison'
  | 'profile'
  | 'session';