import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Download, Shield, Calendar, User, File } from 'lucide-react';
import type { AuditLog } from '@/types/audit';

export function AuditLogViewer() {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const logsPerPage = 50;

  useEffect(() => {
    if (userRole === 'admin') {
      fetchLogs();
    } else {
      setLoading(false);
    }
  }, [userRole, currentPage, actionFilter, statusFilter, searchTerm]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false })
        .range((currentPage - 1) * logsPerPage, currentPage * logsPerPage - 1);

      // Apply filters
      if (actionFilter !== 'all') {
        query = query.eq('action_type', actionFilter);
      }
      
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      
      if (searchTerm.trim()) {
        query = query.or(`action_type.ilike.%${searchTerm}%,details->>'email'.ilike.%${searchTerm}%`);
      }

      const { data, error, count } = await query;
      
      if (error) throw error;
      
      setLogs(data || []);
      setTotalLogs(count || 0);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast({
        title: "Fehler",
        description: "Audit-Logs konnten nicht geladen werden",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const exportLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(10000);
      
      if (error) throw error;
      
      const csvContent = [
        // CSV headers
        'Timestamp,User ID,Action Type,Resource Type,Resource ID,Status,IP Address,Details',
        // CSV rows
        ...data.map(log => [
          log.timestamp,
          log.user_id || '',
          log.action_type,
          log.resource_type || '',
          log.resource_id || '',
          log.status,
          log.ip_address || '',
          JSON.stringify(log.details).replace(/"/g, '""')
        ].join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Erfolg",
        description: "Audit-Logs wurden exportiert"
      });
    } catch (error) {
      console.error('Error exporting logs:', error);
      toast({
        title: "Fehler",
        description: "Export fehlgeschlagen",
        variant: "destructive"
      });
    }
  };

  const getActionTypeIcon = (actionType: string) => {
    if (actionType.includes('login') || actionType.includes('logout')) return <User className="h-4 w-4" />;
    if (actionType.includes('file')) return <File className="h-4 w-4" />;
    if (actionType.includes('role') || actionType.includes('admin')) return <Shield className="h-4 w-4" />;
    return <Calendar className="h-4 w-4" />;
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'success': return 'default';
      case 'failure': return 'destructive';
      case 'warning': return 'secondary';
      default: return 'outline';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDetails = (details: Record<string, any>) => {
    return Object.entries(details)
      .filter(([key]) => !['sensitiveData'].includes(key))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ');
  };

  if (userRole !== 'admin') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4" />
            <p>Zugriff verweigert. Administratorrechte erforderlich.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Shield className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Audit Log Viewer</h1>
        </div>
        <Button onClick={exportLogs} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter & Search</CardTitle>
          <CardDescription>
            Durchsuchen und filtern Sie die Audit-Logs nach verschiedenen Kriterien
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Suchen..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Action Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Aktionen</SelectItem>
                <SelectItem value="user_login">Login</SelectItem>
                <SelectItem value="user_logout">Logout</SelectItem>
                <SelectItem value="user_login_failed">Login Fehler</SelectItem>
                <SelectItem value="user_role_changed">Rolle geändert</SelectItem>
                <SelectItem value="user_invited">Benutzer eingeladen</SelectItem>
                <SelectItem value="file_uploaded">Datei hochgeladen</SelectItem>
                <SelectItem value="comparison_performed">Vergleich durchgeführt</SelectItem>
                <SelectItem value="security_event">Sicherheitsereignis</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="success">Erfolg</SelectItem>
                <SelectItem value="failure">Fehler</SelectItem>
                <SelectItem value="warning">Warnung</SelectItem>
              </SelectContent>
            </Select>
            
            <Button 
              onClick={() => {
                setSearchTerm('');
                setActionFilter('all');
                setStatusFilter('all');
                setCurrentPage(1);
              }}
              variant="outline"
            >
              Filter zurücksetzen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Logs ({totalLogs} Einträge)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-sm">
                        {formatTimestamp(log.timestamp)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getActionTypeIcon(log.action_type)}
                          <span className="text-sm">{log.action_type}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{log.resource_type || '-'}</div>
                          {log.resource_id && (
                            <div className="text-muted-foreground text-xs">
                              {log.resource_id.length > 20 
                                ? log.resource_id.substring(0, 20) + '...' 
                                : log.resource_id}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(log.status)}>
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.user_id ? log.user_id.substring(0, 8) + '...' : '-'}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-xs text-muted-foreground truncate">
                          {formatDetails(log.details)}
                        </div>
                        {log.error_message && (
                          <div className="text-xs text-destructive mt-1">
                            {log.error_message}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {logs.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  Keine Audit-Logs gefunden.
                </div>
              )}
              
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Seite {currentPage} von {Math.ceil(totalLogs / logsPerPage)}
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Vorherige
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => p + 1)}
                    disabled={currentPage >= Math.ceil(totalLogs / logsPerPage)}
                  >
                    Nächste
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}