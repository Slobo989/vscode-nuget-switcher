import * as vscode from 'vscode';
import { findSwitchCandidates, switchToProjectReferences, switchToPackageReferences, getSwitchStatus } from './switcher';
import { SwitchCandidate } from './types';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const switchToProjects = vscode.commands.registerCommand(
    'nugetSwitcher.switchToProjects',
    async () => { await handleSwitchToProjects(); await updateStatusBar(); }
  );

  const switchToPackages = vscode.commands.registerCommand(
    'nugetSwitcher.switchToPackages',
    async () => { await handleSwitchToPackages(); await updateStatusBar(); }
  );

  const showStatus = vscode.commands.registerCommand(
    'nugetSwitcher.showStatus',
    handleShowStatus
  );

  // Single status bar button that changes dynamically
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.show();

  // Watch for .nugetswitch.json file changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.nugetswitch.json');
  watcher.onDidCreate(() => updateStatusBar());
  watcher.onDidDelete(() => updateStatusBar());
  watcher.onDidChange(() => updateStatusBar());

  context.subscriptions.push(switchToProjects, switchToPackages, showStatus, statusBarItem, watcher);

  // Set initial state
  updateStatusBar();
}

async function updateStatusBar(): Promise<void> {
  const manifests = await getSwitchStatus();
  if (manifests.length > 0) {
    const totalSwitches = manifests.reduce((sum, m) => sum + m.switches.length, 0);
    statusBarItem.text = `$(package) Project → NuGet (${totalSwitches})`;
    statusBarItem.tooltip = `Revert ${totalSwitches} switched reference(s) back to PackageReferences`;
    statusBarItem.command = 'nugetSwitcher.switchToPackages';
  } else {
    statusBarItem.text = '$(arrow-swap) NuGet → Project';
    statusBarItem.tooltip = 'Switch PackageReferences to ProjectReferences';
    statusBarItem.command = 'nugetSwitcher.switchToProjects';
  }
}

async function handleSwitchToProjects(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'NuGet Switcher',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Discovering projects...' });

      const candidates = await findSwitchCandidates();

      if (candidates.length === 0) {
        vscode.window.showInformationMessage(
          'No switchable PackageReferences found. Make sure matching projects are in the workspace or additional search paths.'
        );
        return;
      }

      // Let user pick which references to switch
      const selected = await showCandidatePicker(candidates);
      if (!selected || selected.length === 0) return;

      progress.report({ message: `Switching ${selected.length} reference(s)...` });

      const result = await switchToProjectReferences(selected);

      if (result.failed === 0) {
        vscode.window.showInformationMessage(
          `Successfully switched ${result.succeeded} reference(s) to ProjectReferences.`
        );
      } else {
        vscode.window.showWarningMessage(
          `Switched ${result.succeeded} reference(s), ${result.failed} failed.`
        );
      }
    }
  );
}

async function handleSwitchToPackages(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'NuGet Switcher',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Reverting to PackageReferences...' });

      const result = await switchToPackageReferences();

      if (result.succeeded === 0 && result.failed === 0) {
        vscode.window.showInformationMessage(
          'No switched references found. Nothing to revert.'
        );
        return;
      }

      if (result.failed === 0) {
        vscode.window.showInformationMessage(
          `Successfully reverted ${result.succeeded} reference(s) to PackageReferences.`
        );
      } else {
        vscode.window.showWarningMessage(
          `Reverted ${result.succeeded} reference(s), ${result.failed} failed.`
        );
      }
    }
  );
}

async function handleShowStatus(): Promise<void> {
  const manifests = await getSwitchStatus();

  if (manifests.length === 0) {
    vscode.window.showInformationMessage('No active reference switches.');
    return;
  }

  const lines: string[] = ['# NuGet Switcher — Active Switches\n'];

  for (const manifest of manifests) {
    lines.push(`## ${manifest.sourceProject}`);
    lines.push(`Switched at: ${manifest.switchedAt}\n`);
    for (const s of manifest.switches) {
      lines.push(`- **${s.packageId}** (v${s.version}) → \`${s.projectPath}\``);
    }
    lines.push('');
  }

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function showCandidatePicker(
  candidates: SwitchCandidate[]
): Promise<SwitchCandidate[] | undefined> {
  interface CandidateItem extends vscode.QuickPickItem {
    candidate: SwitchCandidate;
  }

  const items: CandidateItem[] = candidates.map((c) => ({
    label: c.packageReference.name,
    description: `v${c.packageReference.version}`,
    detail: `${c.sourceProject.projectName} → ${c.matchingProject.name}`,
    picked: true,
    candidate: c,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select PackageReferences to switch to ProjectReferences',
    title: 'NuGet Reference Switcher',
  });

  return picked?.map((p) => p.candidate);
}

export function deactivate() {}
