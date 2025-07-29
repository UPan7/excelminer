import Fuse from 'fuse.js';

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
}

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
  matchedStandards?: string[]; // Which standards this smelter was found in
  sourceStandard?: string; // Primary standard where match was found
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

export class ComparisonEngine {
  private rmiData: RMIData[];
  private facilitySearchEngine: Fuse<RMIData>;
  private standardsUsed: string[];
  private metalsChecked: string[];

  constructor(rmiData: RMIData[], standardsUsed: string[] = [], metalsChecked: string[] = []) {
    this.rmiData = rmiData;
    this.standardsUsed = standardsUsed;
    this.metalsChecked = metalsChecked;
    
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

  private isConformantStatus(status: string): boolean {
    const conformantStatuses = [
      'conformant',
      'active',
      'compliant',
      'certified',
      'approved',
      'conform',
      'valid',
      'rmi' // Добавляем 'rmi' как валидный статус
    ];
    
    const normalizedStatus = status.toLowerCase().trim();
    console.log('Проверка статуса:', normalizedStatus);
    
    // Если статус пустой, но плавильня найдена в RMI списке, считаем ее соответствующей
    if (!normalizedStatus) {
      console.log('Пустой статус, но плавильня найдена в RMI - считаем соответствующей');
      return true;
    }
    
    return conformantStatuses.some(conformantStatus => 
      normalizedStatus.includes(conformantStatus)
    );
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
        const standards = [...new Set(idMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus) || 'Unknown'))];
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
      const standards = [...new Set(nameMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus) || 'Unknown'))];
      return { match: nameMatches[0], standards };
    }

    return null;
  }

  private getStandardFromAssessmentStatus(status: string): string | null {
    const statusLower = status.toLowerCase();
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
        const standards = [...new Set(allMatches.map(m => this.getStandardFromAssessmentStatus(m.assessmentStatus) || 'Unknown'))];
        
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
      
      // Start with unknown status
      let result: ComparisonResult = {
        id: resultId,
        supplierName,
        smelterName: smelter.smelterName,
        metal: smelter.metal,
        country: smelter.smelterCountry,
        smelterIdentificationNumber: smelter.smelterIdentificationNumber,
        matchStatus: 'unknown'
      };

      console.log(`Сравнение плавильни: ${smelter.smelterName}, ID: ${smelter.smelterIdentificationNumber}, Металл: ${smelter.metal}`);
      
      // Try exact match first
      const exactMatch = this.findExactMatch(smelter);
      
      if (exactMatch) {
        console.log(`Точное совпадение найдено для ${smelter.smelterName}: ${exactMatch.match.standardFacilityName}, статус: ${exactMatch.match.assessmentStatus}`);
        
        result.matchedFacilityName = exactMatch.match.standardFacilityName;
        result.matchedFacilityId = exactMatch.match.facilityId;
        result.rmiAssessmentStatus = exactMatch.match.assessmentStatus;
        result.confidenceScore = 1.0;
        result.matchedStandards = exactMatch.standards;
        result.sourceStandard = exactMatch.standards[0];
        
        // Determine if conformant based on assessment status
        if (this.isConformantStatus(exactMatch.match.assessmentStatus)) {
          result.matchStatus = 'conformant';
        } else {
          result.matchStatus = 'non-conformant';
        }
      } else {
        // Try fuzzy match
        const fuzzyMatch = this.findFuzzyMatch(smelter);
        
        if (fuzzyMatch) {
          console.log(`Нечеткое совпадение найдено для ${smelter.smelterName}: ${fuzzyMatch.match.standardFacilityName}, оценка: ${fuzzyMatch.score}, статус: ${fuzzyMatch.match.assessmentStatus}`);
          
          result.matchedFacilityName = fuzzyMatch.match.standardFacilityName;
          result.matchedFacilityId = fuzzyMatch.match.facilityId;
          result.rmiAssessmentStatus = fuzzyMatch.match.assessmentStatus;
          result.confidenceScore = fuzzyMatch.score;
          result.matchedStandards = fuzzyMatch.standards;
          result.sourceStandard = fuzzyMatch.standards[0];
          
          // For fuzzy matches, mark as pending verification if confidence is moderate
          if (fuzzyMatch.score >= 0.8) {
            // High confidence fuzzy match
            if (this.isConformantStatus(fuzzyMatch.match.assessmentStatus)) {
              result.matchStatus = 'conformant';
            } else {
              result.matchStatus = 'non-conformant';
            }
          } else {
            // Moderate confidence - needs verification
            result.matchStatus = 'pending-verification';
          }
        } else {
          console.log(`Совпадений не найдено для: ${smelter.smelterName}`);
        }
        // If no fuzzy match found, keep status as 'unknown'
      }

      results.push(result);
    });

    return results;
  }

  public getComparisonSummary(results: ComparisonResult[]): ComparisonSummary {
    const total = results.length;
    const conformant = results.filter(r => r.matchStatus === 'conformant').length;
    const nonConformant = results.filter(r => r.matchStatus === 'non-conformant').length;
    const unknown = results.filter(r => r.matchStatus === 'unknown').length;
    const pending = results.filter(r => r.matchStatus === 'pending-verification').length;

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
      const standardResults = results.filter(r => r.matchedStandards?.includes(standard) || r.sourceStandard === standard);
      const standardConformant = standardResults.filter(r => r.matchStatus === 'conformant').length;
      byStandard[standard] = {
        conformant: standardConformant,
        total: standardResults.length,
        percentage: standardResults.length > 0 ? Math.round((standardConformant / standardResults.length) * 100) : 0
      };
    });

    return {
      totalChecked: total,
      standardsUsed: this.standardsUsed,
      metalsChecked: this.metalsChecked,
      conformant,
      nonConformant,
      unknown,
      pending,
      conformantPercentage: total > 0 ? Math.round((conformant / total) * 100) : 0,
      byMetal,
      byStandard
    };
  }
}

export function createComparisonEngine(rmiDataList: RMIData[], standardsUsed: string[] = [], metalsChecked: string[] = []): ComparisonEngine {
  return new ComparisonEngine(rmiDataList, standardsUsed, metalsChecked);
}
