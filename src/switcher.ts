import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SwitchManifest,
  SwitchRecord,
  SwitchCandidate,
  DiscoveredProject,
} from './types';
import { parseCsproj, replacePackageWithProject, replaceProjectWithPackage } from './csprojParser';
import { discoverProjects } from './projectDiscovery';

const MANIFEST_EXTENSION = '.nugetswitch.json';

/**
 * Finds all switchable PackageReferences across workspace projects.
 * A PackageReference is switchable if a local project matches by name/packageId.
 */
export async function findSwitchCandidates(): Promise<SwitchCandidate[]> {
  const discoveredProjects = await discoverProjects();
  const candidates: SwitchCandidate[] = [];

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return candidates;

  // Parse all workspace projects for their PackageReferences
  for (const project of discoveredProjects) {
    const csprojInfo = await parseCsproj(project.csprojPath);

    for (const pkgRef of csprojInfo.packageReferences) {
      const match = findMatchingProject(pkgRef.name, discoveredProjects, project.csprojPath);
      if (match) {
        candidates.push({
          packageReference: pkgRef,
          matchingProject: match,
          sourceProject: csprojInfo,
        });
      }
    }
  }

  return candidates;
}

/**
 * Executes the switch from PackageReference to ProjectReference.
 */
export async function switchToProjectReferences(
  candidates: SwitchCandidate[]
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  // Group candidates by source project
  const grouped = groupBySource(candidates);

  for (const [sourcePath, items] of grouped) {
    const switches: SwitchRecord[] = [];

    for (const candidate of items) {
      const relativePath = path.relative(
        path.dirname(sourcePath),
        candidate.matchingProject.csprojPath
      );

      const success = await replacePackageWithProject(
        sourcePath,
        candidate.packageReference.name,
        relativePath
      );

      if (success) {
        switches.push({
          packageId: candidate.packageReference.name,
          version: candidate.packageReference.version,
          projectPath: relativePath,
          condition: candidate.packageReference.condition,
        });
        succeeded++;
      } else {
        failed++;
      }
    }

    // Save manifest for reverting
    if (switches.length > 0) {
      await saveManifest(sourcePath, switches);
    }
  }

  // Auto-restore if configured
  const config = vscode.workspace.getConfiguration('nugetSwitcher');
  if (config.get<boolean>('autoRestore', true)) {
    await runDotnetRestore();
  }

  return { succeeded, failed };
}

/**
 * Reverts all switched references back to PackageReferences using saved manifests.
 */
export async function switchToPackageReferences(): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  const manifests = await findManifests();

  for (const manifestPath of manifests) {
    const manifest = await loadManifest(manifestPath);
    if (!manifest) continue;

    const csprojPath = manifest.sourceProject;

    for (const record of manifest.switches) {
      const success = await replaceProjectWithPackage(
        csprojPath,
        record.projectPath,
        record.packageId,
        record.version
      );

      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    // Remove manifest after successful revert
    if (failed === 0) {
      await fs.unlink(manifestPath);
    }
  }

  // Auto-restore if configured
  const config = vscode.workspace.getConfiguration('nugetSwitcher');
  if (config.get<boolean>('autoRestore', true)) {
    await runDotnetRestore();
  }

  return { succeeded, failed };
}

/**
 * Gets the current switch status across the workspace.
 */
export async function getSwitchStatus(): Promise<SwitchManifest[]> {
  const manifests = await findManifests();
  const results: SwitchManifest[] = [];

  for (const manifestPath of manifests) {
    const manifest = await loadManifest(manifestPath);
    if (manifest) {
      results.push(manifest);
    }
  }

  return results;
}

function findMatchingProject(
  packageName: string,
  projects: DiscoveredProject[],
  excludeCsprojPath: string
): DiscoveredProject | undefined {
  const normalized = packageName.toLowerCase();

  return projects.find((p) => {
    if (path.normalize(p.csprojPath).toLowerCase() === path.normalize(excludeCsprojPath).toLowerCase()) {
      return false;
    }
    return (
      p.name.toLowerCase() === normalized ||
      p.packageId?.toLowerCase() === normalized ||
      p.assemblyName?.toLowerCase() === normalized
    );
  });
}

function groupBySource(candidates: SwitchCandidate[]): Map<string, SwitchCandidate[]> {
  const map = new Map<string, SwitchCandidate[]>();
  for (const c of candidates) {
    const key = c.sourceProject.filePath;
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return map;
}

async function saveManifest(csprojPath: string, switches: SwitchRecord[]): Promise<void> {
  const manifestPath = csprojPath.replace(/\.csproj$/i, MANIFEST_EXTENSION);
  const manifest: SwitchManifest = {
    switchedAt: new Date().toISOString(),
    sourceProject: csprojPath,
    switches,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

async function loadManifest(manifestPath: string): Promise<SwitchManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as SwitchManifest).sourceProject !== 'string' ||
      typeof (parsed as SwitchManifest).switchedAt !== 'string' ||
      !Array.isArray((parsed as SwitchManifest).switches) ||
      !(parsed as SwitchManifest).switches.every(
        (s) =>
          typeof s === 'object' && s !== null &&
          typeof s.packageId === 'string' &&
          typeof s.version === 'string' &&
          typeof s.projectPath === 'string'
      )
    ) {
      return null;
    }

    return parsed as SwitchManifest;
  } catch {
    return null;
  }
}

async function findManifests(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return [];

  const manifests: string[] = [];

  for (const folder of workspaceFolders) {
    const pattern = new vscode.RelativePattern(folder, `**/*${MANIFEST_EXTENSION}`);
    const files = await vscode.workspace.findFiles(pattern);
    manifests.push(...files.map((f) => f.fsPath));
  }

  return manifests;
}

async function runDotnetRestore(): Promise<void> {
  const terminal = vscode.window.createTerminal('NuGet Switcher');
  terminal.sendText('dotnet restore');
  terminal.show(true);
}
