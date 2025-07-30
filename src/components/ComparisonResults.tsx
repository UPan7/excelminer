import React, { useState, useMemo } from 'react';
import { Search, Filter, Download, ChevronDown, ChevronRight, AlertCircle, CheckCircle, XCircle, Clock, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import * as XLSX from 'xlsx';

export interface ComparisonResult {
  id: string;
  supplierName: string;
  smelterName: string;
  metal: string;
  country: string;
  smelterIdentificationNumber: string;
  matchStatus: 'conformant' | 'active' | 'non-conformant' | 'attention-required' | 'unknown' | 'pending-verification';
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
  active: number;
  nonConformant: number;
  attentionRequired: number;
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
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [metalFilter, setMetalFilter] = useState<string[]>([]);
  const [supplierFilter, setSupplierFilter] = useState<string[]>([]);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState<keyof ComparisonResult>('smelterName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Calculate statistics
  const stats = useMemo(() => {
    const total = results.length;
    const conformant = results.filter(r => r.matchStatus === 'conformant').length;
    const active = results.filter(r => r.matchStatus === 'active').length;
    const nonConformant = results.filter(r => r.matchStatus === 'non-conformant').length;
    const attentionRequired = results.filter(r => r.matchStatus === 'attention-required').length;
    const unknown = results.filter(r => r.matchStatus === 'unknown').length;
    const pending = results.filter(r => r.matchStatus === 'pending-verification').length;

    return {
      total,
      conformant,
      active,
      nonConformant,
      attentionRequired,
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

      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(result.matchStatus);
      const matchesMetal = metalFilter.length === 0 || metalFilter.includes(result.metal);
      const matchesSupplier = supplierFilter.length === 0 || supplierFilter.includes(result.supplierName);
      const matchesCountry = countryFilter.length === 0 || countryFilter.includes(result.country);

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
      case 'active':
        return <Clock className="h-4 w-4 text-blue-600" />;
      case 'non-conformant':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'attention-required':
        return <AlertCircle className="h-4 w-4 text-orange-600" />;
      case 'unknown':
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
      case 'pending-verification':
        return <Clock className="h-4 w-4 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: ComparisonResult['matchStatus']) => {
    switch (status) {
      case 'conformant':
        return <Badge className="bg-green-600 hover:bg-green-700">Konform</Badge>;
      case 'active':
        return <Badge className="bg-blue-600 hover:bg-blue-700">Active</Badge>;
      case 'non-conformant':
        return <Badge variant="destructive">Nicht konform</Badge>;
      case 'attention-required':
        return <Badge className="bg-orange-600 hover:bg-orange-700">Erfordert Aufmerksamkeit</Badge>;
      case 'unknown':
        return <Badge className="bg-gray-600 hover:bg-gray-700">Unbekannt</Badge>;
      case 'pending-verification':
        return <Badge className="bg-yellow-600 hover:bg-yellow-700">Überprüfung</Badge>;
    }
  };

  // Multi-select component
  const MultiSelect = ({ 
    options, 
    value, 
    onChange, 
    placeholder 
  }: { 
    options: string[]; 
    value: string[]; 
    onChange: (value: string[]) => void; 
    placeholder: string;
  }) => {
    const [open, setOpen] = useState(false);

    const handleToggle = (option: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const newValue = value.includes(option)
        ? value.filter(v => v !== option)
        : [...value, option];
      onChange(newValue);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="justify-between w-full"
            onClick={() => setOpen(!open)}
          >
            <span className="truncate">
              {value.length === 0 
                ? placeholder 
                : value.length === 1 
                  ? value[0] 
                  : `${value.length} ausgewählt`
              }
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0 bg-background z-50" align="start">
          <div className="max-h-64 overflow-auto">
            {options.map((option) => (
              <div
                key={option}
                className="flex items-center space-x-2 px-4 py-2 hover:bg-muted cursor-pointer"
                onClick={(e) => handleToggle(option, e)}
              >
                <Checkbox
                  checked={value.includes(option)}
                  onChange={() => {}} // Handled by parent onClick
                />
                <span className="text-sm">{option}</span>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
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
              Geprüft: {summary.totalChecked} Schmelzereien | 
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
                    <span className="text-sm">Active:</span>
                    <span className="text-sm font-medium text-blue-600">{summary.active}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Nicht konform:</span>
                    <span className="text-sm font-medium text-red-600">{summary.nonConformant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Erfordert Aufmerksamkeit:</span>
                    <span className="text-sm font-medium text-orange-600">{summary.attentionRequired}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Unbekannt:</span>
                    <span className="text-sm font-medium text-gray-600">{summary.unknown}</span>
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
            <CardTitle className="text-sm font-medium">Gesamte Schmelzereien</CardTitle>
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
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Nicht konform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.nonConformant}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Erfordert Aufmerksamkeit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.attentionRequired}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unbekannt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600">{stats.unknown}</div>
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
                {filteredAndSortedResults.length} von {results.length} Schmelzereien
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline" 
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter([]);
                  setMetalFilter([]);
                  setSupplierFilter([]);
                  setCountryFilter([]);
                }}
              >
                <Filter className="h-4 w-4 mr-2" />
                Löschen
              </Button>
              <Button onClick={exportToExcel} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Excel exportieren
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-5 gap-4 mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Schmelzereien suchen..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <MultiSelect
              options={['conformant', 'active', 'non-conformant', 'attention-required', 'unknown', 'pending-verification']}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Alle Status"
            />

            <MultiSelect
              options={uniqueMetals}
              value={metalFilter}
              onChange={setMetalFilter}
              placeholder="Alle Metalle"
            />

            <MultiSelect
              options={uniqueSuppliers}
              value={supplierFilter}
              onChange={setSupplierFilter}
              placeholder="Alle Lieferanten"
            />

            <MultiSelect
              options={uniqueCountries}
              value={countryFilter}
              onChange={setCountryFilter}
              placeholder="Alle Länder"
            />
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
                    className="cursor-pointer hover:bg-muted/50 w-32"
                    onClick={() => handleSort('smelterName')}
                  >
                    Schmelzereiname
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