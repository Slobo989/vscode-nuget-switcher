import * as vscode from 'vscode';
import * as path from 'path';
import { glob } from 'glob';
import { DiscoveredProject } from './types';
import { parseCsprojForIdentity } from './csprojParser';

/**
 * Discovers all .csproj files in the workspace and additional search paths.
 */
export async function discoverProjects(): Promise<DiscoveredProject[]> {
  const config = vscode.workspace.getConfiguration('nugetSwitcher');
  const excludePatterns = config.get<string[]>('excludePatterns', [
    '**/node_modules/**',
    '**/bin/**',
    '**/obj/**',
  ]);
  const additionalPaths = config.get<string[]>('additionalSearchPaths', []);

  const projects: DiscoveredProject[] = [];

  // Search workspace folders
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const found = await findCsprojFiles(folder.uri.fsPath, excludePatterns);
      projects.push(...found);
    }
  }

  // Search additional paths
  for (const searchPath of additionalPaths) {
    const resolved = resolvePathVariables(searchPath);
    const found = await findCsprojFiles(resolved, excludePatterns);
    projects.push(...found);
  }

  return deduplicateProjects(projects);
}

async function findCsprojFiles(
  rootPath: string,
  excludePatterns: string[]
): Promise<DiscoveredProject[]> {
  const pattern = '**/*.csproj';
  const files = await glob(pattern, {
    cwd: rootPath,
    absolute: true,
    ignore: excludePatterns,
  });

  const projects: DiscoveredProject[] = [];

  for (const filePath of files) {
    const identity = await parseCsprojForIdentity(filePath);
    projects.push({
      name: identity.projectName,
      csprojPath: filePath,
      assemblyName: identity.assemblyName,
      packageId: identity.packageId,
    });
  }

  return projects;
}

function resolvePathVariables(inputPath: string): string {
  return inputPath.replace(/\$\{workspaceFolder\}/g, () => {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? '';
  });
}

function deduplicateProjects(projects: DiscoveredProject[]): DiscoveredProject[] {
  const seen = new Map<string, DiscoveredProject>();
  for (const project of projects) {
    const key = path.normalize(project.csprojPath).toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, project);
    }
  }
  return Array.from(seen.values());
}
