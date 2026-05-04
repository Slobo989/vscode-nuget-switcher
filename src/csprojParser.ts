import * as fs from 'fs/promises';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { CsprojInfo, PackageReference, ProjectReference } from './types';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name: string) => {
    return ['PackageReference', 'ProjectReference', 'ItemGroup'].includes(name);
  },
};

export interface ProjectIdentity {
  projectName: string;
  assemblyName?: string;
  packageId?: string;
}

/**
 * Parses a .csproj to extract its identity (name, assembly name, package ID).
 */
export async function parseCsprojForIdentity(csprojPath: string): Promise<ProjectIdentity> {
  const content = await fs.readFile(csprojPath, 'utf-8');
  const parser = new XMLParser(parserOptions);
  const doc = parser.parse(content);

  const projectName = path.basename(csprojPath, '.csproj');
  let assemblyName: string | undefined;
  let packageId: string | undefined;

  const propertyGroups = getPropertyGroups(doc);
  for (const pg of propertyGroups) {
    if (pg.AssemblyName) {
      assemblyName = pg.AssemblyName;
    }
    if (pg.PackageId) {
      packageId = pg.PackageId;
    }
  }

  return {
    projectName,
    assemblyName: assemblyName ?? projectName,
    packageId: packageId ?? projectName,
  };
}

/**
 * Parses a .csproj file to extract PackageReferences and ProjectReferences.
 */
export async function parseCsproj(csprojPath: string): Promise<CsprojInfo> {
  const content = await fs.readFile(csprojPath, 'utf-8');
  const parser = new XMLParser(parserOptions);
  const doc = parser.parse(content);

  const projectName = path.basename(csprojPath, '.csproj');
  const packageReferences: PackageReference[] = [];
  const projectReferences: ProjectReference[] = [];

  const itemGroups = getItemGroups(doc);

  for (const ig of itemGroups) {
    // Extract PackageReferences
    if (ig.PackageReference) {
      for (const pr of ig.PackageReference) {
        const name = pr['@_Include'] || '';
        const version = pr['@_Version'] || pr.Version || '';
        const condition = ig['@_Condition'] || pr['@_Condition'];
        if (name) {
          packageReferences.push({ name, version, condition });
        }
      }
    }

    // Extract ProjectReferences
    if (ig.ProjectReference) {
      for (const pr of ig.ProjectReference) {
        const refPath = pr['@_Include'] || '';
        if (refPath) {
          const refName = path.basename(refPath, '.csproj');
          projectReferences.push({ path: refPath, name: refName });
        }
      }
    }
  }

  return {
    filePath: csprojPath,
    projectName,
    packageReferences,
    projectReferences,
  };
}

/**
 * Replaces a PackageReference with a ProjectReference in a .csproj file.
 * Uses text manipulation to preserve formatting.
 */
export async function replacePackageWithProject(
  csprojPath: string,
  packageName: string,
  projectRelativePath: string
): Promise<boolean> {
  let content = await fs.readFile(csprojPath, 'utf-8');

  // Match the PackageReference element (self-closing or with children)
  const selfClosingRegex = new RegExp(
    `([ \\t]*)<PackageReference\\s+Include="${escapeRegex(packageName)}"[^/]*/>`,
    'i'
  );
  const openCloseRegex = new RegExp(
    `([ \\t]*)<PackageReference\\s+Include="${escapeRegex(packageName)}"[^>]*>[\\s\\S]*?</PackageReference>`,
    'i'
  );

  const projectRefElement = `<ProjectReference Include="${projectRelativePath}" />`;

  let replaced = false;

  if (selfClosingRegex.test(content)) {
    content = content.replace(selfClosingRegex, `$1${projectRefElement}`);
    replaced = true;
  } else if (openCloseRegex.test(content)) {
    content = content.replace(openCloseRegex, `$1${projectRefElement}`);
    replaced = true;
  }

  if (replaced) {
    await fs.writeFile(csprojPath, content, 'utf-8');
  }

  return replaced;
}

/**
 * Replaces a ProjectReference back with a PackageReference.
 */
export async function replaceProjectWithPackage(
  csprojPath: string,
  projectRelativePath: string,
  packageName: string,
  packageVersion: string
): Promise<boolean> {
  let content = await fs.readFile(csprojPath, 'utf-8');

  // Build a regex that matches the path with either / or \ separators
  const pathPattern = projectRelativePath
    .split(/[\\/]/)
    .map(segment => escapeRegex(segment))
    .join('[\\\\/]');

  const selfClosingRegex = new RegExp(
    `([ \\t]*)<ProjectReference\\s+Include="${pathPattern}"[^/]*/>`,
    'i'
  );
  const openCloseRegex = new RegExp(
    `([ \\t]*)<ProjectReference\\s+Include="${pathPattern}"[^>]*>[\\s\\S]*?</ProjectReference>`,
    'i'
  );

  const packageRefElement = `<PackageReference Include="${packageName}" Version="${packageVersion}" />`;

  let replaced = false;

  if (selfClosingRegex.test(content)) {
    content = content.replace(selfClosingRegex, `$1${packageRefElement}`);
    replaced = true;
  } else if (openCloseRegex.test(content)) {
    content = content.replace(openCloseRegex, `$1${packageRefElement}`);
    replaced = true;
  }

  if (replaced) {
    await fs.writeFile(csprojPath, content, 'utf-8');
  }

  return replaced;
}

function getPropertyGroups(doc: any): any[] {
  const project = doc?.Project;
  if (!project) return [];
  const pgs = project.PropertyGroup;
  if (!pgs) return [];
  return Array.isArray(pgs) ? pgs : [pgs];
}

function getItemGroups(doc: any): any[] {
  const project = doc?.Project;
  if (!project) return [];
  const igs = project.ItemGroup;
  if (!igs) return [];
  return Array.isArray(igs) ? igs : [igs];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
