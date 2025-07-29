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
}

export class ComparisonEngine {
  private rmiData: RMIData[];
  private facilitySearchEngine: Fuse<RMIData>;

  constructor(rmiData: RMIData[]) {
    this.rmiData = rmiData;
    
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
      'valid'
    ];
    
    const normalizedStatus = status.toLowerCase().trim();
    console.log('Проверка статуса:', normalizedStatus);
    
    return conformantStatuses.some(conformantStatus => 
      normalizedStatus.includes(conformantStatus)
    );
  }

  private findExactMatch(cmrtSmelter: CMRTData): RMIData | null {
    // First try exact ID match
    if (cmrtSmelter.smelterIdentificationNumber) {
      const idMatch = this.rmiData.find(rmi => 
        rmi.facilityId && 
        rmi.facilityId.toLowerCase() === cmrtSmelter.smelterIdentificationNumber.toLowerCase()
      );
      if (idMatch) return idMatch;
    }

    // Then try exact name match within same metal type
    const normalizedSmelterName = this.normalizeString(cmrtSmelter.smelterName);
    const nameMatch = this.rmiData.find(rmi => {
      const normalizedRmiName = this.normalizeString(rmi.standardFacilityName);
      const metalMatch = !cmrtSmelter.metal || !rmi.metal || 
        cmrtSmelter.metal.toLowerCase() === rmi.metal.toLowerCase();
      
      return normalizedRmiName === normalizedSmelterName && metalMatch;
    });

    return nameMatch || null;
  }

  private findFuzzyMatch(cmrtSmelter: CMRTData): { match: RMIData; score: number } | null {
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
        return {
          match: bestMatch.item,
          score: confidenceScore
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
        console.log(`Точное совпадение найдено для ${smelter.smelterName}: ${exactMatch.standardFacilityName}, статус: ${exactMatch.assessmentStatus}`);
        
        result.matchedFacilityName = exactMatch.standardFacilityName;
        result.matchedFacilityId = exactMatch.facilityId;
        result.rmiAssessmentStatus = exactMatch.assessmentStatus;
        result.confidenceScore = 1.0;
        
        // Determine if conformant based on assessment status
        if (this.isConformantStatus(exactMatch.assessmentStatus)) {
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

  public getMatchingStats(results: ComparisonResult[]) {
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
      conformantPercentage: total > 0 ? Math.round((conformant / total) * 100) : 0,
      matchedPercentage: total > 0 ? Math.round(((conformant + nonConformant + pending) / total) * 100) : 0
    };
  }
}

export function createComparisonEngine(rmiDataList: RMIData[]): ComparisonEngine {
  return new ComparisonEngine(rmiDataList);
}
