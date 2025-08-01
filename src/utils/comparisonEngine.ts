import Fuse from 'fuse.js';
import { ComparisonError, FileParsingError } from '@/types/errors';
import { validateData, cmrtDataSchema, rmiDataSchema } from '@/schemas/validationSchemas';

export interface CMRTData {
  metal: string;
  smelterName: string;
  smelterCountry: string;
  smelterIdentificationNumber: string;
}

export interface RMIData {
  facilityId: string;
  standardFacilityName: string;
  metal: string;
  assessmentStatus: string;
  countryLocation?: string;
  stateProvinceRegion?: string;
  city?: string;
  smelterReference?: string;
}

export interface ComparisonResult {
  id: string;
  supplierName: string;
  smelterName: string;
  metal: string;
  country: string;
  smelterIdentificationNumber: string;
  matchStatus: 'conformant' | 'active' | 'non-conformant' | 'attention-required';
  rmiAssessmentStatus?: string;
  confidenceScore?: number;
  matchedFacilityName?: string;
  matchedFacilityId?: string;
  matchedStandards?: string[]; // Which standards this smelter was found in
  sourceStandard?: string; // Primary standard where match was found
  countryLocation?: string;
  stateProvinceRegion?: string;
  city?: string;
  smelterReference?: string;
}

export interface ComparisonSummary {
  totalChecked: number;
  standardsUsed: string[];
  metalsChecked: string[];
  conformant: number;
  active: number;
  nonConformant: number;
  attentionRequired: number;
  conformantPercentage: number;
  byMetal: { [metal: string]: { conformant: number; total: number; percentage: number } };
  byStandard: { [standard: string]: { conformant: number; total: number; percentage: number } };
}

export class ComparisonEngine {
  private rmiData: RMIData[];
  private facilitySearchEngine: Fuse<RMIData>;
  private standardsUsed: string[];
  private metalsChecked: string[];

  constructor(rmiData: RMIData[], standardsUsed: string[] = [], metalsChecked: string[] = []) {
    try {
      // Validate input data
      this.rmiData = validateData(rmiDataSchema.array(), rmiData, 'RMI data initialization');
      this.standardsUsed = standardsUsed;
      this.metalsChecked = metalsChecked;
    } catch (error) {
      throw new ComparisonError('Fehler beim Initialisieren der Vergleichsengine', { error: error instanceof Error ? error.message : error });
    }
    
    // Configure fuzzy search for facility names
    this.facilitySearchEngine = new Fuse(rmiData, {
      keys: [
        { name: 'standardFacilityName', weight: 0.7 },
        { name: 'facilityId', weight: 0.3 }
      ],
      threshold: 0.3, // Lower = more strict matching
      includeScore: true,
      minMatchCharLength: 3,
    });
  }

  private normalizeString(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/\b(ltd|inc|corp|corporation|limited|gmbh|sa|llc|co|company)\b\.?/g, '') // Remove company suffixes
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private getConformityStatus(status: string): 'conformant' | 'active' | 'non-conformant' | 'attention-required' {
    // Extract the actual status after the colon (remove standard prefix)
    let actualStatus = status;
    if (status.includes(':')) {
      actualStatus = status.split(':')[1].trim();
    }
    
    const normalizedStatus = actualStatus.toLowerCase().trim();
    
    // Conformant = "Konform"
    if (normalizedStatus.includes('conformant') || normalizedStatus.includes('conform')) {
      return 'conformant';
    }
    
    // Active = "Active" (in der Bewertung)
    if (normalizedStatus.includes('active')) {
      return 'active';
    }
    
    // Non-Conformant = "Nicht konform"
    if (normalizedStatus.includes('non-conformant') || normalizedStatus.includes('non conformant')) {
      return 'non-conformant';
    }
    
    // Alle anderen Status gelten als "erfordert Aufmerksamkeit"
    return 'attention-required';
  }

  private isConformantStatus(status: string): boolean {
    const conformityStatus = this.getConformityStatus(status);
    return conformityStatus === 'conformant';
  }

  private findExactMatch(cmrtSmelter: CMRTData): { match: RMIData; standards: string[] } | null {
    // First try exact ID match
    if (cmrtSmelter.smelterIdentificationNumber) {
      const idMatches = this.rmiData.filter(rmi => 
        rmi.facilityId && 
        rmi.facilityId.toLowerCase() === cmrtSmelter.smelterIdentificationNumber.toLowerCase()
      );
      if (idMatches.length > 0) {
        // Get all standards where this facility was found
        const standards = [...new Set(idMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus)).filter(Boolean))] as string[];
        return { match: idMatches[0], standards };
      }
    }

    // Then try exact name match within same metal type
    const normalizedSmelterName = this.normalizeString(cmrtSmelter.smelterName);
    const nameMatches = this.rmiData.filter(rmi => {
      const normalizedRmiName = this.normalizeString(rmi.standardFacilityName);
      const metalMatch = !cmrtSmelter.metal || !rmi.metal || 
        cmrtSmelter.metal.toLowerCase() === rmi.metal.toLowerCase();
      
      return normalizedRmiName === normalizedSmelterName && metalMatch;
    });

    if (nameMatches.length > 0) {
      const standards = [...new Set(nameMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus)).filter(Boolean))] as string[];
      return { match: nameMatches[0], standards };
    }

    return null;
  }

  private getStandardFromAssessmentStatus(status: string): string | null {
    const statusLower = status.toLowerCase();
    // Check if the status starts with a standard name (from our modified format)
    if (statusLower.startsWith('cmrt:')) return 'CMRT';
    if (statusLower.startsWith('emrt:')) return 'EMRT';
    if (statusLower.startsWith('amrt:')) return 'AMRT';
    
    // Fallback to checking content
    if (statusLower.includes('cmrt') || statusLower.includes('conflict minerals')) return 'CMRT';
    if (statusLower.includes('emrt') || statusLower.includes('extended minerals')) return 'EMRT';
    if (statusLower.includes('amrt') || statusLower.includes('aluminium')) return 'AMRT';
    if (statusLower.includes('rmi') || statusLower.includes('conformant')) return 'RMI';
    return null;
  }

  private findFuzzyMatch(cmrtSmelter: CMRTData): { match: RMIData; score: number; standards: string[] } | null {
    // Filter by metal type if available
    const metalFilteredData = cmrtSmelter.metal 
      ? this.rmiData.filter(rmi => 
          !rmi.metal || rmi.metal.toLowerCase() === cmrtSmelter.metal.toLowerCase()
        )
      : this.rmiData;

    if (metalFilteredData.length === 0) {
      return null;
    }

    // Create a temporary search engine for metal-filtered data
    const tempSearchEngine = new Fuse(metalFilteredData, {
      keys: [
        { name: 'standardFacilityName', weight: 0.8 },
        { name: 'facilityId', weight: 0.2 }
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 3,
    });

    const searchResults = tempSearchEngine.search(cmrtSmelter.smelterName);
    
    if (searchResults.length > 0 && searchResults[0].score !== undefined) {
      const bestMatch = searchResults[0];
      const confidenceScore = 1 - bestMatch.score; // Convert Fuse score to confidence
      
      // Only return matches with reasonable confidence
      if (confidenceScore >= 0.6) {
        // Find all matches for this facility to get all standards
        const allMatches = metalFilteredData.filter(rmi => 
          this.normalizeString(rmi.standardFacilityName) === this.normalizeString(bestMatch.item.standardFacilityName)
        );
        const standards = [...new Set(allMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus)).filter(Boolean))] as string[];
        
        return {
          match: bestMatch.item,
          score: confidenceScore,
          standards
        };
      }
    }

    return null;
  }

  public compareSupplierData(
    supplierName: string,
    cmrtData: CMRTData[]
  ): ComparisonResult[] {
    const results: ComparisonResult[] = [];

    cmrtData.forEach((smelter, index) => {
      const resultId = `${supplierName}-${index}`;
      
      // Start with attention-required status
      let result: ComparisonResult = {
        id: resultId,
        supplierName,
        smelterName: smelter.smelterName,
        metal: smelter.metal,
        country: smelter.smelterCountry,
        smelterIdentificationNumber: smelter.smelterIdentificationNumber,
        matchStatus: 'attention-required'
      };

      // Processing smelter comparison...
      
      // Try exact match first
      const exactMatch = this.findExactMatch(smelter);
      
      if (exactMatch) {
        // Exact match found
        
        result.matchedFacilityName = exactMatch.match.standardFacilityName;
        result.matchedFacilityId = exactMatch.match.facilityId;
        result.rmiAssessmentStatus = exactMatch.match.assessmentStatus;
        result.confidenceScore = 1.0;
        result.matchedStandards = exactMatch.standards;
        result.sourceStandard = exactMatch.standards[0];
         result.countryLocation = exactMatch.match.countryLocation;
         result.stateProvinceRegion = exactMatch.match.stateProvinceRegion;
         result.city = exactMatch.match.city;
         result.smelterReference = exactMatch.match.smelterReference;
        
        // Determine status based on assessment status
        const conformityStatus = this.getConformityStatus(exactMatch.match.assessmentStatus);
        result.matchStatus = conformityStatus;
      } else {
        // Try fuzzy match
        const fuzzyMatch = this.findFuzzyMatch(smelter);
        
        if (fuzzyMatch) {
          // Fuzzy match found
          
          result.matchedFacilityName = fuzzyMatch.match.standardFacilityName;
          result.matchedFacilityId = fuzzyMatch.match.facilityId;
          result.rmiAssessmentStatus = fuzzyMatch.match.assessmentStatus;
          result.confidenceScore = fuzzyMatch.score;
          result.matchedStandards = fuzzyMatch.standards;
          result.sourceStandard = fuzzyMatch.standards[0];
           result.countryLocation = fuzzyMatch.match.countryLocation;
           result.stateProvinceRegion = fuzzyMatch.match.stateProvinceRegion;
           result.city = fuzzyMatch.match.city;
           result.smelterReference = fuzzyMatch.match.smelterReference;
          
          // For fuzzy matches with high confidence
          if (fuzzyMatch.score >= 0.8) {
            const conformityStatus = this.getConformityStatus(fuzzyMatch.match.assessmentStatus);
            result.matchStatus = conformityStatus;
          } else {
            // Moderate confidence - mark as attention required
            result.matchStatus = 'attention-required';
          }
        }
        // If no fuzzy match found, keep status as 'attention-required'
      }

      results.push(result);
    });

    return results;
  }

  public getComparisonSummary(results: ComparisonResult[]): ComparisonSummary {
    const total = results.length;
    const conformant = results.filter(r => r.matchStatus === 'conformant').length;
    const active = results.filter(r => r.matchStatus === 'active').length;
    const nonConformant = results.filter(r => r.matchStatus === 'non-conformant').length;
    const attentionRequired = results.filter(r => r.matchStatus === 'attention-required').length;

    // Calculate by metal
    const byMetal: { [metal: string]: { conformant: number; total: number; percentage: number } } = {};
    this.metalsChecked.forEach(metal => {
      const metalResults = results.filter(r => r.metal === metal);
      const metalConformant = metalResults.filter(r => r.matchStatus === 'conformant').length;
      byMetal[metal] = {
        conformant: metalConformant,
        total: metalResults.length,
        percentage: metalResults.length > 0 ? Math.round((metalConformant / metalResults.length) * 100) : 0
      };
    });

    // Calculate by standard
    const byStandard: { [standard: string]: { conformant: number; total: number; percentage: number } } = {};
    this.standardsUsed.forEach(standard => {
      // Count all results that were checked against this standard
      const standardResults = results.filter(r => 
        r.matchedStandards?.includes(standard) || 
        r.sourceStandard === standard ||
        // Also count results where we attempted to match against this standard
        this.metalsChecked.some(metal => r.metal === metal)
      );
      const standardConformant = standardResults.filter(r => 
        r.matchStatus === 'conformant' && 
        (r.matchedStandards?.includes(standard) || r.sourceStandard === standard)
      ).length;
      byStandard[standard] = {
        conformant: standardConformant,
        total: results.filter(r => this.metalsChecked.includes(r.metal)).length, // Total results for this standard
        percentage: results.length > 0 ? Math.round((standardConformant / results.length) * 100) : 0
      };
    });

    return {
      totalChecked: total,
      standardsUsed: this.standardsUsed,
      metalsChecked: this.metalsChecked,
      conformant,
      active,
      nonConformant,
      attentionRequired,
      conformantPercentage: total > 0 ? Math.round((conformant / total) * 100) : 0,
      byMetal,
      byStandard
    };
  }
}

export function createComparisonEngine(rmiDataList: RMIData[], standardsUsed: string[] = [], metalsChecked: string[] = []): ComparisonEngine {
  return new ComparisonEngine(rmiDataList, standardsUsed, metalsChecked);
}
