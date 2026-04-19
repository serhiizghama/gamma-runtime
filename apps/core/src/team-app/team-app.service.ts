import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspaceService } from '../agents/workspace.service';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, extname, relative } from 'path';

export interface AppStatus {
  exists: boolean;
  lastModified: number | null;
  files: string[];
  sizeBytes: number;
}

interface FileResult {
  content: Buffer;
  mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
};

@Injectable()
export class TeamAppService {
  private readonly logger = new Logger(TeamAppService.name);

  constructor(private readonly workspace: WorkspaceService) {}

  getAppDir(teamId: string): string {
    return join(this.workspace.getTeamPath(teamId), 'project', 'app');
  }

  getStatus(teamId: string): AppStatus {
    const appDir = this.getAppDir(teamId);
    const indexPath = join(appDir, 'index.html');

    if (!existsSync(indexPath)) {
      return { exists: false, lastModified: null, files: [], sizeBytes: 0 };
    }

    const files = this.listFilesRecursive(appDir);
    let totalSize = 0;
    let latestModified = 0;

    for (const file of files) {
      const fullPath = join(appDir, file);
      const stat = statSync(fullPath);
      totalSize += stat.size;
      const mtime = stat.mtimeMs;
      if (mtime > latestModified) latestModified = mtime;
    }

    return {
      exists: true,
      lastModified: Math.floor(latestModified),
      files,
      sizeBytes: totalSize,
    };
  }

  readFile(teamId: string, filePath: string): FileResult {
    const appDir = this.getAppDir(teamId);

    // Security: resolve to absolute and ensure it's within appDir
    const resolved = resolve(appDir, filePath);
    if (!resolved.startsWith(resolve(appDir))) {
      throw new ForbiddenException('Path traversal is not allowed');
    }

    if (!existsSync(resolved)) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      // Try index.html inside directory
      const indexPath = join(resolved, 'index.html');
      if (existsSync(indexPath)) {
        return {
          content: readFileSync(indexPath),
          mimeType: 'text/html',
        };
      }
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const ext = extname(resolved).toLowerCase();
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return {
      content: readFileSync(resolved),
      mimeType,
    };
  }

  private listFilesRecursive(dir: string, prefix = ''): string[] {
    if (!existsSync(dir)) return [];

    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...this.listFilesRecursive(join(dir, entry.name), relativePath));
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }

  // ============================================================
  //  DATA COMPOSER
  //  Builds a unified `data.json` from artifact files that agents
  //  produce under `project/` — vacancies, scoring, applications,
  //  candidate profile. Served in place of the static data.json so
  //  the app always reflects real team output.
  // ============================================================

  composeData(teamId: string): Buffer {
    const projectDir = join(this.workspace.getTeamPath(teamId), 'project');

    const vacanciesFile = this.readVacanciesFile(projectDir);
    const vacancies: any[] = Array.isArray(vacanciesFile?.vacancies)
      ? vacanciesFile.vacancies
      : Array.isArray(vacanciesFile)
        ? vacanciesFile
        : [];
    const scoring = this.readScoring(projectDir);
    const scoreById = new Map<string, any>(
      (scoring?.scoredVacancies ?? []).map((s: any) => [s.id, s]),
    );

    // Merge matchScore/classification into vacancy records
    const enrichedVacancies = vacancies.map((v) => {
      const s = scoreById.get(v.id);
      const matchScore = s ? Math.round(s.matchScore ?? s.totalScore ?? 0) : 0;
      return {
        ...v,
        matchScore,
        classification: s?.classification ?? null,
        strengths: s?.strengths ?? [],
        concerns: s?.concerns ?? [],
        recommendation: s?.recommendation ?? null,
        status: v.status ?? 'new',
        isNew: v.isNew ?? false,
        techStack: v.techStack ?? [],
        summary: v.summary ?? '',
      };
    });

    const analyses: Record<string, any> = {};
    for (const s of scoring?.scoredVacancies ?? []) {
      analyses[s.id] = {
        matchScore: Math.round(s.matchScore ?? s.totalScore ?? 0),
        classification: s.classification,
        reasoning: s.reasoning,
        breakdown: this.normalizeBreakdown(s.reasoning),
        strengths: s.strengths ?? [],
        concerns: s.concerns ?? [],
        recommendation: s.recommendation ?? '',
      };
    }

    const applications = this.readApplications(projectDir, enrichedVacancies);
    const reports = this.readReports(projectDir);
    const candidate = this.readCandidateFull(projectDir);
    const currentBrief = this.briefFromFullProfile(candidate);
    const sources = this.countSources(enrichedVacancies);
    // Scout's raw totalFound (before filtering); afterFilter is what actually ended up in the file.
    const totalFound = typeof vacanciesFile?.totalFound === 'number' ? vacanciesFile.totalFound : vacancies.length;
    const afterFilter = typeof vacanciesFile?.afterFilter === 'number' ? vacanciesFile.afterFilter : vacancies.length;

    const data = {
      pipeline: this.buildPipeline(projectDir, enrichedVacancies.length, Object.keys(analyses).length, Object.keys(applications).length),
      scoutStatus: {
        status: afterFilter > 0 ? 'completed' : 'idle',
        sources,
        totalFound,
        afterFilter,
        lastRunAt: null,
        currentBrief,
      },
      vacancies: enrichedVacancies,
      analyses,
      applications,
      reports,
      candidate,
      activityLog: [],
      runMeta: {
        currentRunId: null,
        previousRunId: null,
        newVacanciesCount: 0,
        returningVacanciesCount: 0,
        removedSinceLastRun: 0,
      },
    };

    return Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  }

  private readJsonSafe(path: string): any | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      this.logger.warn(`Failed to parse ${path}: ${err}`);
      return null;
    }
  }

  private readVacanciesFile(projectDir: string): any | null {
    // Returns the whole file object so we can access totalFound/afterFilter
    // alongside the vacancies array.
    const candidates = ['vacancies-nodejs.json', 'vacancies.json'];
    for (const name of candidates) {
      const data = this.readJsonSafe(join(projectDir, name));
      if (data) return data;
    }
    return null;
  }

  private readScoring(projectDir: string): any | null {
    const candidates = ['detailed-scoring.json', 'scoring.json', 'analysis.json'];
    for (const name of candidates) {
      const data = this.readJsonSafe(join(projectDir, name));
      if (data) return data;
    }
    return null;
  }

  private readApplications(projectDir: string, vacancies: any[]): Record<string, any> {
    const appsDir = join(projectDir, 'applications');
    if (!existsSync(appsDir)) return {};

    const result: Record<string, any> = {};
    let entries: string[];
    try {
      entries = readdirSync(appsDir);
    } catch {
      return {};
    }

    // Group files by slug: {slug}-cv.md, {slug}-cover-letter.md
    const grouped = new Map<string, { cv?: string; coverLetter?: string }>();
    for (const file of entries) {
      const m = file.match(/^(.+?)-(cv|cover-letter)\.md$/i);
      if (!m) continue;
      const [, slug, kind] = m;
      let content = '';
      try {
        content = readFileSync(join(appsDir, file), 'utf8');
      } catch {
        continue;
      }
      const bucket = grouped.get(slug) ?? {};
      if (kind.toLowerCase() === 'cv') bucket.cv = content;
      else bucket.coverLetter = content;
      grouped.set(slug, bucket);
    }

    // Map slug → vacancy id by fuzzy company-name match
    const slugFor = (company: string) => company.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const vacByCompany = new Map<string, any>();
    for (const v of vacancies) {
      if (v.company) vacByCompany.set(slugFor(v.company), v);
    }

    for (const [slug, bundle] of grouped) {
      const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const vac = vacByCompany.get(normalizedSlug);
      const vacId = vac?.id ?? slug;
      const coverLetter = bundle.coverLetter ?? '';
      const cv = bundle.cv ?? '';
      const ats = this.computeAts(cv, vac);
      result[vacId] = {
        status: 'draft',
        atsScore: ats.atsScore,
        cv,
        coverLetter,
        coverLetterPreview: this.excerpt(coverLetter, 600),
        coverLetterLangs: { en: coverLetter },
        cvChanges: [],
        keywordsMatched: ats.keywordsMatched,
        keywordsMissing: ats.keywordsMissing,
        slug: normalizedSlug,
        company: vac?.company ?? slug,
        vacancyTitle: vac?.title ?? null,
        vacancyUrl: vac?.url ?? null,
        orphan: !vac,
      };
    }
    return result;
  }

  private computeAts(
    cv: string,
    vac: any,
  ): { keywordsMatched: string[]; keywordsMissing: string[]; atsScore: number } {
    const stack: string[] = Array.isArray(vac?.techStack) ? vac.techStack : [];
    if (!cv || !stack.length) {
      return { keywordsMatched: [], keywordsMissing: stack, atsScore: 0 };
    }
    const cvLower = cv.toLowerCase();
    const matched: string[] = [];
    const missing: string[] = [];
    for (const raw of stack) {
      const tech = String(raw);
      // Normalize common variants: "NestJS" vs "Nest.js", "AWS (Lambda, S3)" vs "AWS"
      const base = tech.replace(/\s*\(.*\)\s*/g, '').trim().toLowerCase();
      const variants = new Set<string>([tech.toLowerCase(), base]);
      if (base.includes('.')) variants.add(base.replace(/\./g, ''));
      if (base.includes(' ')) variants.add(base.replace(/\s+/g, ''));
      const hit = Array.from(variants).some((v) => v && cvLower.includes(v));
      (hit ? matched : missing).push(tech);
    }
    const total = stack.length;
    const atsScore = total > 0 ? Math.round((matched.length / total) * 100) : 0;
    return { keywordsMatched: matched, keywordsMissing: missing, atsScore };
  }

  private excerpt(text: string, maxChars: number): string {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(0, maxChars).replace(/\s+\S*$/, '').trim() + '…';
  }

  private normalizeBreakdown(reasoning: any): any {
    if (!reasoning || typeof reasoning !== 'object') return null;
    const pick = (keys: string[]) => {
      for (const k of keys) {
        if (reasoning[k] && typeof reasoning[k] === 'object') return reasoning[k];
      }
      return null;
    };
    const out: Record<string, any> = {};
    const techStack = pick(['techStack', 'tech_stack', 'tech']);
    if (techStack) out.techStack = techStack;
    const experience = pick(['experienceLevel', 'experience', 'experience_level', 'seniority']);
    if (experience) out.experienceLevel = experience;
    const location = pick(['location', 'geo', 'timezone']);
    if (location) out.location = location;
    const salary = pick(['salary', 'comp', 'compensation']);
    if (salary) out.salary = salary;
    const growth = pick(['growthAndCulture', 'growth_and_culture', 'growth', 'culture']);
    if (growth) out.growthAndCulture = growth;
    return Object.keys(out).length ? out : null;
  }

  private readReports(projectDir: string): any[] {
    const reportsDir = join(projectDir, 'reports');
    if (!existsSync(reportsDir)) return [];
    let entries: string[];
    try {
      entries = readdirSync(reportsDir);
    } catch {
      return [];
    }
    const out: any[] = [];
    for (const filename of entries) {
      if (!filename.toLowerCase().endsWith('.md')) continue;
      const full = join(reportsDir, filename);
      try {
        const stat = statSync(full);
        const content = readFileSync(full, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        out.push({
          filename,
          title: titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/i, ''),
          content,
          modifiedAt: Math.floor(stat.mtimeMs),
          sizeBytes: stat.size,
        });
      } catch {
        // ignore broken entry
      }
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  private readCandidateFull(projectDir: string): any | null {
    const jsonPath = join(projectDir, 'candidate-profile.json');
    const json = this.readJsonSafe(jsonPath);
    if (json) return json;
    const yamlPath = join(projectDir, 'candidate-profile.yaml');
    if (!existsSync(yamlPath)) return null;
    try {
      return this.parseYaml(readFileSync(yamlPath, 'utf8'));
    } catch (err) {
      this.logger.warn(`Failed to parse candidate-profile.yaml: ${err}`);
      return null;
    }
  }

  private briefFromFullProfile(profile: any | null): any {
    const fallback = {
      targetRole: 'Backend Developer',
      techStack: ['Node.js', 'TypeScript', 'NestJS'],
      locations: ['Remote'],
      salaryMin: 5000,
      experienceYears: 6,
      employmentTypes: ['full-time'],
    };
    if (!profile) return fallback;
    return { ...fallback, ...this.briefFromProfile(profile) };
  }

  private countSources(vacancies: any[]): any[] {
    const defaults = [
      { name: 'djinni.co', icon: '🇺🇦', keys: ['djinni'] },
      { name: 'LinkedIn', icon: '🔗', keys: ['linkedin'] },
      { name: 'DOU.ua', icon: '🇺🇦', keys: ['dou'] },
      { name: 'Indeed', icon: '🌍', keys: ['indeed'] },
      { name: 'weworkremotely', icon: '🌐', keys: ['weworkremotely'] },
    ];
    return defaults.map((d) => {
      const count = vacancies.filter((v) => {
        const src = String(v.source ?? '').toLowerCase();
        return d.keys.some((k) => src.includes(k));
      }).length;
      return {
        name: d.name,
        icon: d.icon,
        vacanciesFound: count,
        status: count > 0 ? 'done' : 'idle',
      };
    });
  }

  private buildPipeline(projectDir: string, vacCount: number, scoreCount: number, appCount: number): any {
    const reportsDir = join(projectDir, 'reports');
    const reportCount = existsSync(reportsDir)
      ? (() => {
          try {
            return readdirSync(reportsDir).filter((f) => f.endsWith('.md')).length;
          } catch {
            return 0;
          }
        })()
      : 0;

    const stage = (agent: string, emoji: string, output: number): any => ({
      agent,
      emoji,
      status: output > 0 ? 'completed' : 'waiting',
      inputCount: 0,
      outputCount: output,
      durationMs: 0,
    });

    return {
      status: 'idle',
      runId: null,
      startedAt: null,
      completedAt: null,
      stages: [
        stage('Scout', '🔍', vacCount),
        stage('Analyst', '📊', scoreCount),
        stage('Tailor', '✂️', appCount),
        stage('Reporter', '📝', reportCount),
      ],
    };
  }

  private briefFromProfile(p: any): any {
    const out: any = {};
    const role = p?.target?.role;
    if (role) out.targetRole = String(role);
    const workMode = p?.target?.work_mode;
    if (workMode) out.locations = [workMode === 'remote' ? 'Remote' : String(workMode)];
    const salaryMin = p?.target?.salary?.min;
    if (typeof salaryMin === 'number') out.salaryMin = salaryMin;
    const years = p?.experience?.total_years;
    if (typeof years === 'number') out.experienceYears = years;
    const expert = p?.tech_stack?.expert;
    if (Array.isArray(expert) && expert.length) out.techStack = expert.map((x: any) => String(x));
    const etypes = p?.target?.employment_type;
    if (etypes) out.employmentTypes = [String(etypes)];
    return out;
  }

  /**
   * Minimal YAML parser for candidate-profile.yaml.
   * Supports: nested objects via indent, arrays of scalars, quoted strings,
   * numbers, booleans, null. Does NOT support anchors, flow style, or
   * arrays-of-objects (we don't need them here).
   */
  private parseYaml(text: string): any {
    interface L { indent: number; content: string }
    const lines: L[] = [];
    // Strip comments in a quote-aware pass: find first `#` that isn't inside
    // a quoted string, truncate there.
    const stripComment = (raw: string): string => {
      let inQuote: string | null = null;
      for (let j = 0; j < raw.length; j++) {
        const c = raw[j];
        if (inQuote) {
          if (c === inQuote) inQuote = null;
        } else if (c === '"' || c === "'") {
          inQuote = c;
        } else if (c === '#') {
          return raw.slice(0, j);
        }
      }
      return raw;
    };
    for (const rawLine of text.split('\n')) {
      const stripped = stripComment(rawLine);
      if (!stripped.trim()) continue;
      const indent = stripped.length - stripped.trimStart().length;
      lines.push({ indent, content: stripped.trimStart() });
    }

    let i = 0;
    const parseScalar = (val: string): any => {
      const t = val.trim().replace(/^["']|["']$/g, '');
      if (t === 'true') return true;
      if (t === 'false') return false;
      if (t === 'null' || t === '~' || t === '') return null;
      if (/^-?\d+$/.test(t)) return parseInt(t, 10);
      if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
      return t;
    };

    const parseBlock = (minIndent: number): any => {
      if (i >= lines.length || lines[i].indent < minIndent) return null;
      // Array branch
      if (lines[i].content.startsWith('- ')) {
        const arr: any[] = [];
        while (i < lines.length && lines[i].indent === minIndent && lines[i].content.startsWith('- ')) {
          const body = lines[i].content.slice(2);
          // Detect "- key: value" pattern → array item is an object
          const kv = body.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
          if (kv) {
            const [, firstKey, firstRest] = kv;
            const itemObj: any = {};
            if (firstRest.trim() === '') {
              i++;
              if (i < lines.length && lines[i].indent > minIndent + 2) {
                itemObj[firstKey] = parseBlock(lines[i].indent);
              } else {
                itemObj[firstKey] = null;
              }
            } else {
              itemObj[firstKey] = parseScalar(firstRest);
              i++;
            }
            // Subsequent fields of this same item live at indent = minIndent + 2
            while (
              i < lines.length &&
              lines[i].indent === minIndent + 2 &&
              !lines[i].content.startsWith('- ')
            ) {
              const m2 = lines[i].content.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
              if (!m2) { i++; continue; }
              const [, k, rest] = m2;
              i++;
              if (rest.trim() === '') {
                if (i < lines.length && lines[i].indent > minIndent + 2) {
                  itemObj[k] = parseBlock(lines[i].indent);
                } else {
                  itemObj[k] = null;
                }
              } else {
                itemObj[k] = parseScalar(rest);
              }
            }
            arr.push(itemObj);
          } else {
            arr.push(parseScalar(body));
            i++;
          }
        }
        return arr;
      }
      // Object branch
      const obj: any = {};
      while (i < lines.length && lines[i].indent === minIndent && !lines[i].content.startsWith('- ')) {
        const m = lines[i].content.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!m) { i++; continue; }
        const [, key, rest] = m;
        i++;
        if (rest.trim() === '') {
          if (i < lines.length && lines[i].indent > minIndent) {
            obj[key] = parseBlock(lines[i].indent);
          } else {
            obj[key] = null;
          }
        } else {
          obj[key] = parseScalar(rest);
        }
      }
      return obj;
    };

    return parseBlock(0) ?? {};
  }
}
