import React, { useState, useMemo } from 'react';
import { Search, Filter, Download, ChevronDown, ChevronRight, AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import * as XLSX from 'xlsx';

export interface ComparisonResult {
  id: string;
  supplierName: string;
  smelterName: string;
  metal: string;
  country: string;
  smelterIdentificationNumber: string;
  matchStatus: 'conformant' | 'non-conformant' | 'unknown' | 'pending-verification';
  rmiAssessmentStatus?: string;
  confidenceScore?: number;
  matchedFacilityName?: string;
  matchedFacilityId?: string;
  matchedStandards?: string[];
  sourceStandard?: string;
}

export interface ComparisonSummary {
  totalChecked: number;
  standardsUsed: string[];
  metalsChecked: string[];
  conformant: number;
  nonConformant: number;
  unknown: number;
  pending: number;
  conformantPercentage: number;
  byMetal: { [metal: string]: { conformant: number; total: number; percentage: number } };
  byStandard: { [standard: string]: { conformant: number; total: number; percentage: number } };
}

interface ComparisonResultsProps {
  results: ComparisonResult[];
  isProcessing: boolean;
  summary?: ComparisonSummary;
}

export const ComparisonResults: React.FC<ComparisonResultsProps> = ({
  results,
  isProcessing,
  summary
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [metalFilter, setMetalFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<keyof ComparisonResult>('smelterName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Calculate statistics
  const stats = useMemo(() => {
    const total = results.length;
    const conformant = results.filter(r => r.matchStatus === 'conformant').length;
    const nonConformant = results.filter(r => r.matchStatus === 'non-conformant').length;
    const unknown = results.filter(r => r.matchStatus === 'unknown').length;
    const pending = results.filter(r => r.matchStatus === 'pending-verification').length;

    return {
      total,
      conformant,
      nonConformant,
      unknown,
      pending,
      conformantPercentage: total > 0 ? Math.round((conformant / total) * 100) : 0
    };
  }, [results]);

  // Get unique values for filters
  const uniqueSuppliers = useMemo(() => 
    [...new Set(results.map(r => r.supplierName))].sort(),
    [results]
  );

  const uniqueMetals = useMemo(() => 
    [...new Set(results.map(r => r.metal))].filter(Boolean).sort(),
    [results]
  );

  const uniqueCountries = useMemo(() => 
    [...new Set(results.map(r => r.country))].filter(Boolean).sort(),
    [results]
  );

  // Filter and sort results
  const filteredAndSortedResults = useMemo(() => {
    let filtered = results.filter(result => {
      const matchesSearch = searchTerm === '' || 
        result.smelterName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        result.country.toLowerCase().includes(searchTerm.toLowerCase()) ||
        result.supplierName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || result.matchStatus === statusFilter;
      const matchesMetal = metalFilter === 'all' || result.metal === metalFilter;
      const matchesSupplier = supplierFilter === 'all' || result.supplierName === supplierFilter;
      const matchesCountry = countryFilter === 'all' || result.country === countryFilter;

      return matchesSearch && matchesStatus && matchesMetal && matchesSupplier && matchesCountry;
    });

    // Sort results
    filtered.sort((a, b) => {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return sortDirection === 'asc' ? comparison : -comparison;
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        const comparison = aValue - bValue;
        return sortDirection === 'asc' ? comparison : -comparison;
      }
      
      return 0;
    });

    return filtered;
  }, [results, searchTerm, statusFilter, metalFilter, supplierFilter, countryFilter, sortField, sortDirection]);

  const getStatusIcon = (status: ComparisonResult['matchStatus']) => {
    switch (status) {
      case 'conformant':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'non-conformant':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'unknown':
        return <AlertCircle className="h-4 w-4 text-orange-600" />;
      case 'pending-verification':
        return <Clock className="h-4 w-4 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: ComparisonResult['matchStatus']) => {
    switch (status) {
      case 'conformant':
        return <Badge className="bg-green-600 hover:bg-green-700">Konform</Badge>;
      case 'non-conformant':
        return <Badge variant="destructive">Nicht-konform</Badge>;
      case 'unknown':
        return <Badge className="bg-orange-600 hover:bg-orange-700">Unbekannt</Badge>;
      case 'pending-verification':
        return <Badge className="bg-yellow-600 hover:bg-yellow-700">Überprüfung</Badge>;
    }
  };

  const toggleRowExpansion = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const handleSort = (field: keyof ComparisonResult) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const exportToExcel = () => {
    const exportData = filteredAndSortedResults.map(result => ({
      'Supplier': result.supplierName,
      'Smelter Name': result.smelterName,
      'Metal': result.metal,
      'Country': result.country,
      'Smelter ID': result.smelterIdentificationNumber,
      'Match Status': result.matchStatus,
      'RMI Assessment Status': result.rmiAssessmentStatus || '',
      'Confidence Score': result.confidenceScore || '',
      'Matched Facility Name': result.matchedFacilityName || '',
      'Matched Facility ID': result.matchedFacilityId || ''
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Compliance Results');
    XLSX.writeFile(wb, `compliance-results-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (results.length === 0 && !isProcessing) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Detailed Summary Card */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Vergleichszusammenfassung
            </CardTitle>
            <CardDescription>
              Geprüft: {summary.totalChecked} Schmelzen | 
              Standards: {summary.standardsUsed.join(', ')} | 
              Metalle: {summary.metalsChecked.join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Overall Stats */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Gesamtergebnis</h4>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-sm">Konform:</span>
                    <span className="text-sm font-medium text-green-600">
                      {summary.conformant} ({summary.conformantPercentage}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Nicht-konform:</span>
                    <span className="text-sm font-medium text-red-600">{summary.nonConformant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Unbekannt:</span>
                    <span className="text-sm font-medium text-orange-600">{summary.unknown}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Überprüfung:</span>
                    <span className="text-sm font-medium text-yellow-600">{summary.pending}</span>
                  </div>
                </div>
              </div>

              {/* By Metal */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Nach Metall</h4>
                <div className="space-y-1">
                  {Object.entries(summary.byMetal).map(([metal, stats]) => (
                    <div key={metal} className="flex justify-between">
                      <span className="text-sm">{metal}:</span>
                      <span className="text-sm font-medium">
                        {stats.conformant}/{stats.total} ({stats.percentage}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Standard */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Nach Standard</h4>
                <div className="space-y-1">
                  {Object.entries(summary.byStandard).map(([standard, stats]) => (
                    <div key={standard} className="flex justify-between">
                      <span className="text-sm">{standard}:</span>
                      <span className="text-sm font-medium">
                        {stats.conformant}/{stats.total} ({stats.percentage}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Gesamte Schmelzen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Konform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.conformant}</div>
            <p className="text-xs text-muted-foreground">{stats.conformantPercentage}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Nicht-konform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.nonConformant}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unbekannt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.unknown}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Überprüfung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Vergleichsergebnisse</CardTitle>
              <CardDescription>
                {filteredAndSortedResults.length} von {results.length} Schmelzen
              </CardDescription>
            </div>
            <Button onClick={exportToExcel} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Excel exportieren
            </Button>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Schmelzen suchen..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alle Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="conformant">Konform</SelectItem>
                <SelectItem value="non-conformant">Nicht-konform</SelectItem>
                <SelectItem value="unknown">Unbekannt</SelectItem>
                <SelectItem value="pending-verification">Überprüfung</SelectItem>
              </SelectContent>
            </Select>

            <Select value={metalFilter} onValueChange={setMetalFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alle Metalle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Metalle</SelectItem>
                {uniqueMetals.map(metal => (
                  <SelectItem key={metal} value={metal}>{metal}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alle Lieferanten" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Lieferanten</SelectItem>
                {uniqueSuppliers.map(supplier => (
                  <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alle Länder" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="all">Alle Länder</SelectItem>
                {uniqueCountries.map(country => (
                  <SelectItem key={country} value={country}>{country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Clear filters button row */}
          <div className="mt-2">
            <Button
              variant="outline" 
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setMetalFilter('all');
                setSupplierFilter('all');
                setCountryFilter('all');
              }}
            >
              <Filter className="h-4 w-4 mr-2" />
              Löschen
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('supplierName')}
                  >
                    Lieferant
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('smelterName')}
                  >
                    Schmelzname
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('metal')}
                  >
                    Metall
                  </TableHead>
                   <TableHead 
                     className="cursor-pointer hover:bg-muted/50"
                     onClick={() => handleSort('country')}
                   >
                     Land
                   </TableHead>
                   <TableHead 
                     className="cursor-pointer hover:bg-muted/50"
                     onClick={() => handleSort('smelterIdentificationNumber')}
                   >
                     Smelzerei-ID
                   </TableHead>
                   <TableHead 
                     className="cursor-pointer hover:bg-muted/50"
                     onClick={() => handleSort('matchStatus')}
                   >
                     Status
                   </TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {filteredAndSortedResults.map((result) => (
                  <React.Fragment key={result.id}>
                    <TableRow className="hover:bg-muted/50">
                      <TableCell>
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleRowExpansion(result.id)}
                            >
                              {expandedRows.has(result.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        </Collapsible>
                      </TableCell>
                       <TableCell className="font-medium">{result.supplierName}</TableCell>
                       <TableCell>{result.smelterName}</TableCell>
                       <TableCell>{result.metal}</TableCell>
                       <TableCell>{result.country}</TableCell>
                       <TableCell>{result.smelterIdentificationNumber || 'N/A'}</TableCell>
                       <TableCell>
                         <div className="flex items-center gap-2">
                           {getStatusIcon(result.matchStatus)}
                           {getStatusBadge(result.matchStatus)}
                         </div>
                       </TableCell>
                    </TableRow>
                    {expandedRows.has(result.id) && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/25">
                          <div className="p-4 space-y-2">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium">Schmelz-ID:</span> {result.smelterIdentificationNumber || 'N/A'}
                              </div>
                              <div>
                                <span className="font-medium">RMI-Bewertung:</span> {result.rmiAssessmentStatus || 'N/A'}
                              </div>
                              {result.matchedFacilityName && (
                                <div>
                                  <span className="font-medium">Gefundene Einrichtung:</span> {result.matchedFacilityName}
                                </div>
                              )}
                              {result.matchedFacilityId && (
                                <div>
                                  <span className="font-medium">Gefundene Einrichtungs-ID:</span> {result.matchedFacilityId}
                                </div>
                              )}
                              {result.matchedStandards && result.matchedStandards.length > 0 && (
                                <div>
                                  <span className="font-medium">Gefunden in Standards:</span> {result.matchedStandards.join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};