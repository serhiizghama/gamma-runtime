import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface RoleManifestEntry {
  id: string;
  name: string;
  category: string;
  fileName: string;
}

export interface RoleCategory {
  id: string;
  name: string;
  roles: RoleManifestEntry[];
}

const LEADERSHIP_ROLE_IDS = [
  'engineering/engineering-software-architect',
  'engineering/engineering-backend-architect',
  'project-management/project-management-project-shepherd',
  'project-management/project-manager-senior',
  'project-management/project-management-studio-producer',
  'product/product-manager',
  'specialized/agents-orchestrator',
  'specialized/specialized-workflow-architect',
  'job-hunting/job-hunting-squad-leader',
];

const CATEGORY_NAMES: Record<string, string> = {
  academic: 'Academic',
  design: 'Design',
  engineering: 'Engineering',
  'game-development': 'Game Development',
  'job-hunting': 'Job Hunting',
  marketing: 'Marketing',
  'paid-media': 'Paid Media',
  product: 'Product',
  'project-management': 'Project Management',
  sales: 'Sales',
  'spatial-computing': 'Spatial Computing',
  specialized: 'Specialized',
  support: 'Support',
  testing: 'Testing',
};

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);
  private manifest: RoleManifestEntry[] = [];
  private communityRolesPath: string;

  constructor() {
    // Resolve project root: go up from apps/core to monorepo root
    const projectRoot = join(__dirname, '..', '..', '..', '..');
    this.communityRolesPath = join(projectRoot, 'community-roles');
    this.projectRoot = projectRoot;
  }

  private projectRoot: string;

  onModuleInit() {
    const manifestPath = join(this.projectRoot, 'data', 'roles-manifest.json');
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      this.manifest = JSON.parse(raw);
      this.logger.log(`Loaded ${this.manifest.length} roles from manifest`);
    } catch (err) {
      this.logger.warn(`Could not load roles manifest: ${(err as Error).message}`);
      this.manifest = [];
    }
  }

  getGrouped(): { categories: RoleCategory[] } {
    const catMap = new Map<string, RoleManifestEntry[]>();

    for (const role of this.manifest) {
      const list = catMap.get(role.category) ?? [];
      list.push(role);
      catMap.set(role.category, list);
    }

    const categories: RoleCategory[] = [];

    // Virtual "leadership" category first
    const leadershipRoles = this.manifest.filter(r => LEADERSHIP_ROLE_IDS.includes(r.id));
    if (leadershipRoles.length > 0) {
      categories.push({
        id: 'leadership',
        name: 'Leadership',
        roles: leadershipRoles,
      });
    }

    // All other categories
    for (const [catId, roles] of catMap) {
      categories.push({
        id: catId,
        name: CATEGORY_NAMES[catId] ?? catId,
        roles: roles.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // Sort categories by name (Leadership stays first)
    categories.sort((a, b) => {
      if (a.id === 'leadership') return -1;
      if (b.id === 'leadership') return 1;
      return a.name.localeCompare(b.name);
    });

    return { categories };
  }

  findById(roleId: string): RoleManifestEntry | null {
    return this.manifest.find(r => r.id === roleId) ?? null;
  }

  async getRolePrompt(roleId: string): Promise<string> {
    const role = this.findById(roleId);
    if (!role) return '';
    const filePath = join(this.communityRolesPath, role.category, role.fileName);
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      this.logger.warn(`Could not read role file: ${filePath}`);
      return '';
    }
  }
}
