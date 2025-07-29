import React, { useState, useCallback, useEffect } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2, Trash2, Play, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ComparisonResults, type ComparisonResult } from '@/components/ComparisonResults';
import { ComparisonEngine, createComparisonEngine, type CMRTData, type RMIData } from '@/utils/comparisonEngine';

interface FileData {
  id: string;
  name: string;
  type: 'cmrt' | 'rmi' | 'unknown';
  status: 'pending' | 'processing' | 'complete' | 'error';
  size: number;
  data?: any;
  error?: string;
}


const Index = () => {
  const [files, setFiles] = useState<FileData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [comparisonResults, setComparisonResults] = useState<ComparisonResult[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const { toast } = useToast();

  const detectFileType = (filename: string): 'cmrt' | 'rmi' | 'unknown' => {
    const lower = filename.toLowerCase();
    if (lower.includes('cmrt') || lower.includes('emrt')) return 'cmrt';
    if (lower.includes('rmi') || lower.includes('conformant')) return 'rmi';
    return 'unknown';
  };

  const parseExcelFile = async (file: File): Promise<{ cmrtData?: CMRTData[], rmiData?: RMIData[] }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const fileType = detectFileType(file.name);
          
          if (fileType === 'cmrt') {
            // Look for "Smelter List" sheet or similar
            const smelterSheetName = workbook.SheetNames.find(name => 
              name.toLowerCase().includes('smelter') || 
              name.toLowerCase().includes('list')
            ) || workbook.SheetNames[0];
            
            const worksheet = workbook.Sheets[smelterSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            // Find header row and extract data
            const headerRowIndex = jsonData.findIndex((row: any) => 
              row.some((cell: any) => 
                typeof cell === 'string' && 
                (cell.toLowerCase().includes('metal') || 
                 cell.toLowerCase().includes('smelter'))
              )
            );
            
            if (headerRowIndex === -1) {
              throw new Error('Could not find header row in CMRT file');
            }
            
            const headers = jsonData[headerRowIndex] as string[];
            const cmrtData: CMRTData[] = [];
            
            for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
              const row = jsonData[i] as any[];
              if (row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
                const metalIndex = headers.findIndex(h => h && h.toLowerCase().includes('metal'));
                const smelterNameIndex = headers.findIndex(h => h && h.toLowerCase().includes('smelter') && h.toLowerCase().includes('name'));
                const countryIndex = headers.findIndex(h => h && h.toLowerCase().includes('country'));
                const idIndex = headers.findIndex(h => h && h.toLowerCase().includes('identification'));
                
                cmrtData.push({
                  metal: row[metalIndex] || '',
                  smelterName: row[smelterNameIndex] || '',
                  smelterCountry: row[countryIndex] || '',
                  smelterIdentificationNumber: row[idIndex] || '',
                });
              }
            }
            
            resolve({ cmrtData });
          } else if (fileType === 'rmi') {
            // Parse RMI facility list
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            const headerRowIndex = jsonData.findIndex((row: any) => 
              row.some((cell: any) => 
                typeof cell === 'string' && 
                (cell.toLowerCase().includes('facility') || 
                 cell.toLowerCase().includes('standard'))
              )
            );
            
            if (headerRowIndex === -1) {
              throw new Error('Could not find header row in RMI file');
            }
            
            const headers = jsonData[headerRowIndex] as string[];
            const rmiData: RMIData[] = [];
            
            for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
              const row = jsonData[i] as any[];
              if (row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
                const facilityIdIndex = headers.findIndex(h => h && h.toLowerCase().includes('facility') && h.toLowerCase().includes('id'));
                const nameIndex = headers.findIndex(h => h && h.toLowerCase().includes('standard') && h.toLowerCase().includes('facility'));
                const metalIndex = headers.findIndex(h => h && h.toLowerCase().includes('metal'));
                const statusIndex = headers.findIndex(h => h && h.toLowerCase().includes('assessment') && h.toLowerCase().includes('status'));
                
                rmiData.push({
                  facilityId: row[facilityIdIndex] || '',
                  standardFacilityName: row[nameIndex] || '',
                  metal: row[metalIndex] || '',
                  assessmentStatus: row[statusIndex] || '',
                });
              }
            }
            
            resolve({ rmiData });
          } else {
            throw new Error('Unknown file type. Please upload CMRT or RMI files.');
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const processFile = async (fileData: FileData, file: File) => {
    setFiles(prev => prev.map(f => 
      f.id === fileData.id ? { ...f, status: 'processing' } : f
    ));

    try {
      const parsedData = await parseExcelFile(file);
      
      setFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'complete', data: parsedData }
          : f
      ));

      toast({
        title: "File processed successfully",
        description: `${file.name} has been parsed and data extracted.`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      setFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'error', error: errorMessage }
          : f
      ));

      toast({
        variant: "destructive",
        title: "Processing failed",
        description: errorMessage,
      });
    }
  };

  const handleFileUpload = useCallback((uploadedFiles: FileList) => {
    const newFiles: FileData[] = Array.from(uploadedFiles).map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      name: file.name,
      type: detectFileType(file.name),
      status: 'pending',
      size: file.size,
    }));

    setFiles(prev => [...prev, ...newFiles]);

    // Process files automatically
    Array.from(uploadedFiles).forEach((file, index) => {
      processFile(newFiles[index], file);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
  }, [handleFileUpload]);

  const runComparison = async () => {
    // Validate that we have both CMRT and RMI files
    const cmrtFiles = files.filter(f => f.type === 'cmrt' && f.status === 'complete' && f.data?.cmrtData);
    const rmiFiles = files.filter(f => f.type === 'rmi' && f.status === 'complete' && f.data?.rmiData);

    if (cmrtFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "No CMRT files found",
        description: "Please upload at least one CMRT file to run comparison.",
      });
      return;
    }

    if (rmiFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "No RMI files found", 
        description: "Please upload at least one RMI conformant facility list to run comparison.",
      });
      return;
    }

    setIsComparing(true);
    setComparisonResults([]);

    try {
      // Combine all RMI data
      const allRmiData: RMIData[] = [];
      rmiFiles.forEach(file => {
        if (file.data?.rmiData) {
          allRmiData.push(...file.data.rmiData);
        }
      });

      // Create comparison engine
      const engine = createComparisonEngine(allRmiData);
      
      // Process each CMRT file
      const allResults: ComparisonResult[] = [];
      
      for (const cmrtFile of cmrtFiles) {
        if (cmrtFile.data?.cmrtData) {
          const supplierName = cmrtFile.name.replace(/\.(xlsx|xls)$/i, '');
          const results = engine.compareSupplierData(supplierName, cmrtFile.data.cmrtData);
          allResults.push(...results);
        }
      }

      setComparisonResults(allResults);

      toast({
        title: "Comparison completed",
        description: `Processed ${allResults.length} smelters across ${cmrtFiles.length} suppliers.`,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        variant: "destructive",
        title: "Comparison failed",
        description: errorMessage,
      });
    } finally {
      setIsComparing(false);
    }
  };

  const clearAllFiles = () => {
    setFiles([]);
    setComparisonResults([]);
    toast({
      title: "Files cleared",
      description: "All uploaded files have been removed.",
    });
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    // Clear comparison results if removing files that were used in comparison
    if (comparisonResults.length > 0) {
      setComparisonResults([]);
    }
  };

  const getStatusIcon = (status: FileData['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: FileData['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'processing':
        return <Badge className="bg-primary">Processing</Badge>;
      case 'complete':
        return <Badge className="bg-green-600 hover:bg-green-700">Complete</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const getFileTypeBadge = (type: FileData['type']) => {
    switch (type) {
      case 'cmrt':
        return <Badge variant="outline" className="text-blue-600 border-blue-600">CMRT</Badge>;
      case 'rmi':
        return <Badge variant="outline" className="text-purple-600 border-purple-600">RMI</Badge>;
      case 'unknown':
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">CMRT/EMRT Compliance Checker</h1>
          <p className="text-xl text-muted-foreground">
            Upload and process mineral supply chain reports to validate compliance
          </p>
        </div>

        {/* Upload Zone */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Files</CardTitle>
            <CardDescription>
              Drop your CMRT/EMRT reports and RMI conformant facility lists here
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <div className="space-y-2">
                <p className="text-lg font-medium">
                  Drag and drop your Excel files here
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports .xlsx files • CMRT, EMRT, and RMI facility lists
                </p>
                <div className="pt-4">
                  <Button asChild>
                    <label htmlFor="file-upload" className="cursor-pointer">
                      Choose Files
                    </label>
                  </Button>
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    accept=".xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* File List */}
        {files.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Uploaded Files</CardTitle>
                <CardDescription>
                  {files.length} file{files.length !== 1 ? 's' : ''} uploaded
                </CardDescription>
              </div>
              <Button variant="outline" onClick={clearAllFiles}>
                Clear All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      {getStatusIcon(file.status)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{file.name}</p>
                        <div className="flex items-center space-x-2 mt-1">
                          {getFileTypeBadge(file.type)}
                          {getStatusBadge(file.status)}
                          <span className="text-sm text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                        </div>
                        {file.error && (
                          <p className="text-sm text-destructive mt-1">{file.error}</p>
                        )}
                        {file.status === 'complete' && file.data && (
                          <p className="text-sm text-green-600 mt-1">
                            {file.data.cmrtData?.length || file.data.rmiData?.length || 0} records extracted
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Process Files Section */}
        {files.some(f => f.status === 'complete') && (
          <Card>
            <CardHeader>
              <CardTitle>Run Comparison</CardTitle>
              <CardDescription>
                Compare uploaded CMRT files against RMI conformant facility lists
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={runComparison}
                  disabled={isComparing}
                  className="flex items-center gap-2"
                >
                  {isComparing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isComparing ? 'Processing...' : 'Process Files'}
                </Button>
                
                {comparisonResults.length > 0 && (
                  <Button 
                    variant="outline"
                    onClick={() => setComparisonResults([])}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Clear Results
                  </Button>
                )}
              </div>
              
              <div className="mt-4 text-sm text-muted-foreground">
                <p>
                  <strong>CMRT files:</strong> {files.filter(f => f.type === 'cmrt' && f.status === 'complete').length} ready
                </p>
                <p>
                  <strong>RMI files:</strong> {files.filter(f => f.type === 'rmi' && f.status === 'complete').length} ready
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comparison Results */}
        <ComparisonResults 
          results={comparisonResults}
          isProcessing={isComparing}
        />
      </div>
    </div>
  );
};

export default Index;
