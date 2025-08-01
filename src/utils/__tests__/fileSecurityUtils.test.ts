import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeFileName } from '../fileSecurityUtils';

describe('sanitizeFileName', () => {
  describe('Entfernen gefährlicher Zeichen', () => {
    it('sollte Pfad-Separatoren entfernen', () => {
      expect(sanitizeFileName('test/file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test\\file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('/test/file.txt')).toBe('_test_file.txt');
      expect(sanitizeFileName('\\test\\file.txt')).toBe('_test_file.txt');
    });

    it('sollte gefährliche Sonderzeichen entfernen', () => {
      expect(sanitizeFileName('test:file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test*file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test?file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test"file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test<file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test>file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test|file.txt')).toBe('test_file.txt');
    });

    it('sollte mehrere gefährliche Zeichen gleichzeitig ersetzen', () => {
      expect(sanitizeFileName('test/\\:*?"<>|file.txt')).toBe('test__________file.txt');
    });

    it('sollte normale Dateinamen unverändert lassen', () => {
      expect(sanitizeFileName('normal_file.txt')).toBe('normal_file.txt');
      expect(sanitizeFileName('file123.xlsx')).toBe('file123.xlsx');
      expect(sanitizeFileName('test-file_v2.csv')).toBe('test-file_v2.csv');
    });
  });

  describe('Entfernen von ".."', () => {
    it('sollte Path-Traversal-Versuche entfernen', () => {
      expect(sanitizeFileName('../test.txt')).toBe('_test.txt');
      expect(sanitizeFileName('../../test.txt')).toBe('__test.txt');
      expect(sanitizeFileName('test/../file.txt')).toBe('test_file.txt');
      expect(sanitizeFileName('test..file.txt')).toBe('test_file.txt');
    });

    it('sollte mehrere ".." Sequenzen entfernen', () => {
      expect(sanitizeFileName('../../../test.txt')).toBe('___test.txt');
      expect(sanitizeFileName('test....file.txt')).toBe('test__file.txt');
    });

    it('sollte normale Punkte in Erweiterungen beibehalten', () => {
      expect(sanitizeFileName('test.backup.txt')).toBe('test.backup.txt');
    });
  });

  describe('Entfernen führender Punkte', () => {
    it('sollte führende Punkte entfernen', () => {
      expect(sanitizeFileName('.hidden_file.txt')).toBe('hidden_file.txt');
      expect(sanitizeFileName('..hidden_file.txt')).toBe('hidden_file.txt');
      expect(sanitizeFileName('...hidden_file.txt')).toBe('hidden_file.txt');
    });

    it('sollte nur führende Punkte entfernen, nicht alle Punkte', () => {
      expect(sanitizeFileName('.test.backup.txt')).toBe('test.backup.txt');
      expect(sanitizeFileName('..test.file.backup.txt')).toBe('test.file.backup.txt');
    });

    it('sollte Whitespace vor und nach der Bereinigung entfernen', () => {
      expect(sanitizeFileName('  .hidden_file.txt  ')).toBe('hidden_file.txt');
      expect(sanitizeFileName('\t.test.txt\n')).toBe('test.txt');
    });
  });

  describe('Fallback-Name bei leerem Ergebnis', () => {
    it('sollte Fallback-Namen für leere Eingaben verwenden', () => {
      const result = sanitizeFileName('');
      expect(result).toMatch(/^upload_\d+$/);
    });

    it('sollte Fallback-Namen für nur Punkte verwenden', () => {
      const result = sanitizeFileName('...');
      expect(result).toMatch(/^upload_\d+$/);
    });

    it('sollte Fallback-Namen für nur Whitespace verwenden', () => {
      const result = sanitizeFileName('   ');
      expect(result).toMatch(/^upload_\d+$/);
    });

    it('sollte Fallback-Namen für nur gefährliche Zeichen verwenden', () => {
      const result = sanitizeFileName('/\\:*?"<>|');
      expect(result).toMatch(/^upload_\d+$/);
    });

    it('sollte unterschiedliche Zeitstempel für aufeinanderfolgende Aufrufe verwenden', () => {
      const result1 = sanitizeFileName('');
      const result2 = sanitizeFileName('');
      expect(result1).not.toBe(result2);
    });
  });

  describe('Längenbegrenzung', () => {
    it('sollte sehr lange Dateinamen kürzen', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result.endsWith('.txt')).toBe(true);
    });

    it('sollte Erweiterung beim Kürzen beibehalten', () => {
      const longName = 'very_long_filename_' + 'a'.repeat(250) + '.xlsx';
      const result = sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result.endsWith('.xlsx')).toBe(true);
    });

    it('sollte Datei ohne Erweiterung korrekt kürzen', () => {
      const longName = 'a'.repeat(300);
      const result = sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });
  });

  describe('Komplexe Szenarien', () => {
    it('sollte alle Sicherheitsprobleme gleichzeitig behandeln', () => {
      const maliciousName = '../../../.hidden/evil:file"with<bad>chars|.txt';
      const result = sanitizeFileName(maliciousName);
      expect(result).toBe('___hidden_evil_file_with_bad_chars_.txt');
    });

    it('sollte Unicode-Zeichen beibehalten', () => {
      expect(sanitizeFileName('datei_ñoël_文件.txt')).toBe('datei_ñoël_文件.txt');
      expect(sanitizeFileName('tëst_fílé_über.csv')).toBe('tëst_fílé_über.csv');
    });

    it('sollte Leerzeichen in Dateinamen beibehalten', () => {
      expect(sanitizeFileName('my test file.xlsx')).toBe('my test file.xlsx');
      expect(sanitizeFileName('  test file  .txt')).toBe('test file  .txt');
    });

    it('sollte mit null und undefined umgehen können', () => {
      const result1 = sanitizeFileName(null as any);
      const result2 = sanitizeFileName(undefined as any);
      expect(result1).toMatch(/^upload_\d+$/);
      expect(result2).toMatch(/^upload_\d+$/);
    });
  });
});