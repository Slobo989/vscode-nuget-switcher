export interface PackageReference {
  name: string;
  version: string;
  condition?: string;
}

export interface ProjectReference {
  path: string;
  name: string;
}

export interface CsprojInfo {
  filePath: string;
  projectName: string;
  packageReferences: PackageReference[];
  projectReferences: ProjectReference[];
}

export interface SwitchRecord {
  packageId: string;
  version: string;
  projectPath: string;
  condition?: string;
}

export interface SwitchManifest {
  switchedAt: string;
  sourceProject: string;
  switches: SwitchRecord[];
}

export interface DiscoveredProject {
  name: string;
  csprojPath: string;
  assemblyName?: string;
  packageId?: string;
}

export interface SwitchCandidate {
  packageReference: PackageReference;
  matchingProject: DiscoveredProject;
  sourceProject: CsprojInfo;
}
