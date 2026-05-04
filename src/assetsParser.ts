import * as fs from 'fs/promises';
import * as path from 'path';

interface AssetTarget {
  [packageName: string]: {
    type: string;
    dependencies?: Record<string, string>;
  };
}

interface ProjectAssets {
  version: number;
  targets: Record<string, AssetTarget>;
  libraries: Record<string, { type: string; path: string }>;
  project: {
    frameworks: Record<string, {
      targetAlias?: string;
      dependencies?: Record<string, { version: string; autoReferenced?: boolean }>;
    }>;
  };
}

/**
 * Reads and parses a project.assets.json file to get the full dependency graph.
 * Returns the set of package names that are direct or transitive dependencies.
 */
export async function parseProjectAssets(csprojPath: string): Promise<string[]> {
  const objDir = path.join(path.dirname(csprojPath), 'obj');
  const assetsPath = path.join(objDir, 'project.assets.json');

  try {
    await fs.access(assetsPath);
  } catch {
    return [];
  }

  const content = await fs.readFile(assetsPath, 'utf-8');
  const assets: ProjectAssets = JSON.parse(content);

  const packageNames = new Set<string>();

  // Collect from libraries
  if (assets.libraries) {
    for (const [key, lib] of Object.entries(assets.libraries)) {
      if (lib.type === 'package') {
        // key format: "PackageName/Version"
        const name = key.split('/')[0];
        if (name) {
          packageNames.add(name.toLowerCase());
        }
      }
    }
  }

  return Array.from(packageNames);
}

/**
 * Gets direct dependencies from project.assets.json.
 */
export async function getDirectDependencies(
  csprojPath: string
): Promise<Map<string, string>> {
  const objDir = path.join(path.dirname(csprojPath), 'obj');
  const assetsPath = path.join(objDir, 'project.assets.json');

  const deps = new Map<string, string>();

  try {
    await fs.access(assetsPath);
  } catch {
    return deps;
  }

  const content = await fs.readFile(assetsPath, 'utf-8');
  const assets: ProjectAssets = JSON.parse(content);

  if (assets.project?.frameworks) {
    for (const framework of Object.values(assets.project.frameworks)) {
      if (framework.dependencies) {
        for (const [name, info] of Object.entries(framework.dependencies)) {
          if (!info.autoReferenced) {
            deps.set(name.toLowerCase(), info.version);
          }
        }
      }
    }
  }

  return deps;
}
