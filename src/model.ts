import { commands as Commands, Disposable, Event, EventEmitter, ExtensionContext, FileSystemError, FileSystemWatcher, FileType, RelativePattern, TextEditor, Uri, window as Window, workspace as Workspace, WorkspaceFoldersChangeEvent } from 'vscode';
import { AddonOutlineProvider } from './addonOutlineProvider';
import { WadNotifcationProvider } from './notificationProvider';
import { TocFile } from './tocFile';
import { PkgmetaFile } from './pkgmetaFile';
import { anyEvent, dispose, filterEvent, log } from './msutil';
import { TScm,Scm, TValidScm } from './Scm';
import { basename as Basename } from 'path';
import { anyEventMore } from './util';

type TrackedFile = TocFile | PkgmetaFile;

interface EventExt extends Event<Uri> {
  type: string;
}

interface ILibraryEntry {
  name: string;
  url: string;
  scm: TValidScm;
  folder: string;
  version: string;
  tag?: string;
}

export class WadModel {

  private _onDidUpdateTrackedFile = new EventEmitter<Uri>();
  readonly onDidUpdateTrackedFile: Event<Uri> = this._onDidUpdateTrackedFile.event;

  private _onInstalledLibrary = new EventEmitter<Uri>();
  private _addonOutlineProvider: AddonOutlineProvider = new AddonOutlineProvider();
  private _notificationProvider: WadNotifcationProvider = new WadNotifcationProvider();
  private _addonOutlineTreeView = Window.createTreeView('wadTreeView', { treeDataProvider: this._addonOutlineProvider });

  private disposables: Disposable[] = [];

  trackedFiles: Map<string, TrackedFile> = new Map();
  installedLibraryFolders: Map<string, Uri> = new Map();
  ignoredFolders = [
    '.svn',
    '.git',
    '.clone',
  ]

  private deleteTrackedFile(uri: Uri) {
    const uriString = uri.toString(true)
    if (this.trackedFiles.has(uriString)) {
      const trackedFile = this.trackedFiles.get(uriString)
      this.trackedFiles.delete(uriString);
      this._onDidUpdateTrackedFile.fire(uri)
      this._addonOutlineProvider.removeTreeItem(trackedFile!.treeItem!)
    } else {
      [...this.trackedFiles].filter(([_, fileUri]) => fileUri.resourceUri.toString(true).includes(uriString)).map(([_, f]) => {
        this.trackedFiles.delete(f.resourceUri.toString(true));
        this._onDidUpdateTrackedFile.fire(uri)
        this._addonOutlineProvider.removeTreeItem(f.treeItem!)
      })
    }
  }

  private updateTrackedFiles(uri: Uri, trackedFile: TrackedFile) {
    const uriString = uri.toString(true)
    this.trackedFiles.set(uriString, trackedFile);
    this._onDidUpdateTrackedFile.fire(uri);
    this._addonOutlineProvider.addTreeItems(trackedFile.treeItem!);
  }

  private async watchedFileUpdated(uri: Uri) {
    const uriString = uri.toString(true);
    const uriStat = await Workspace.fs.stat(uri);
    if (uriStat.type === FileType.Directory) {
      this.scanFolderForFiles(uri)
    } else {
      let fileToAdd = {} as TrackedFile
      if (/pkgmeta/.test(uriString)) {
        fileToAdd = new PkgmetaFile(uri);
        await fileToAdd.initialized;
        this.updateTrackedFiles(uri, fileToAdd);
      } else if (/.+\.toc/.test(uriString)) {
        fileToAdd = new TocFile(uri);
        await fileToAdd.initialized;
        this.updateTrackedFiles(uri, fileToAdd);
      }
    }
  }

  checkoutDirs: Map<string, Uri> = new Map<string, Uri>();
  trackedWorkspaceFolders: Map<string, Uri> = new Map<string, Uri>();

  private checkIgnoredList = (uri: Uri) => {
    return !this.ignoredFolders.some(i => uri.toString(true).includes(i))
  }

  private scanFolderForFiles = async (uri: Uri) => {
    (await Workspace.findFiles(new RelativePattern(uri, '**/{*.toc,.pkgmeta*,pkgmeta*.y*ml}')))
      .filter(f => this.checkIgnoredList(f))
      // Only include files no deeper than 2 levels from the root of its wortkspace folder.
      .filter((uri) => uri.toString(true).replace(Workspace.getWorkspaceFolder(uri)!.uri.toString(true), '').split('/').length <= 3)
      .map(f => this.watchedFileUpdated(f))
  }

  private onDidChangeWorkspaceFolders = async ({ added, removed }: WorkspaceFoldersChangeEvent): Promise<void> => {
    const workspaceFoldersToAdd = added.filter(f => !this.trackedWorkspaceFolders.has(f.uri.toString(true)))
    const workspaceFoldersToRemove = removed.filter(f => this.trackedWorkspaceFolders.has(f.uri.toString(true)))

    workspaceFoldersToRemove.forEach(f => [...this.trackedFiles].filter(([s, _]) => s.includes(f.uri.toString(true))).map(([_, t]) => {
      this.deleteTrackedFile(t.resourceUri)
      this.checkoutDirs.delete(f.uri.toString(true))
      this.trackedWorkspaceFolders.delete(f.uri.toString(true))
    }))

    workspaceFoldersToAdd.map(f => {
      this.checkoutDirs.set(f.uri.toString(true), Uri.joinPath(f.uri, '\.release', '\.checkout'))
      this.scanFolderForFiles(f.uri)
    })
  }

  private onDidChangeVisibleTextEditors = async (_editors: readonly TextEditor[]): Promise<void> => {

  }

  private onDidChangeConfiguration = (): void => {

  }

  private onCheckedOutDir = (uri: Uri): void => {
    log(uri)
  }

  private checkIfInWorkspace = (uri: Uri) => {
    return typeof (Workspace.getWorkspaceFolder(uri)) !== 'undefined'
  }

  private checkFileTrackingEligibility(uri: Uri) {
    // https://regex101.com/r/lf1YAB/
    return /^\.(?!.+\.ya?ml$)|^(?=[^.]+\.ya?ml$)pkgmeta(?:[_-](?:tbc|bcc|classic|vanilla))?(?:\.ya?ml)?$|^.+\.toc$/i.test(Basename(uri.toString(true)))
  }

  private checkForTrackedFolder = (uri: Uri) => {
    const uriStr = uri.toString(true);
    return [...this.trackedFiles].some(([_, fileUri]) => {
      return fileUri.resourceUri.toString(true).includes(uriStr)
    })
  }
  public getLibraryList = async () => {
    const libraryListText = (await Workspace.fs.readFile(Uri.joinPath(this.localRepoPath, this.defaultLibraryFile))).toString()
    this.libraryList = JSON.parse(libraryListText).libs
    return this.libraryList;
  }


  private localRepoSetup = async () => {
    return new Promise(async (res, rej) => {
      await Workspace.fs.delete(this.localRepoPath, { recursive: true, useTrash: false }).then(void 0, (r) => {
        if (r.code !== 'FileNotFound') {
          log(r)
          rej(r)
        }
      })
      await Workspace.fs.createDirectory(this.localRepoPath);
      const localRepoPath = await this.neededScms.git.clone(this.defaultRepoUrl, this.localRepoPath, { noProgress: true, noCloneDir: true })
      if (localRepoPath) {
        this.localRepoInitialized = true
        const libraryListText = (await Workspace.fs.readFile(Uri.joinPath(this.localRepoPath, this.defaultLibraryFile))).toString()
        this.libraryList = JSON.parse(libraryListText).libs
        return res(localRepoPath)
      } else {
        return rej('Error')
      }
    })
  };

  localRepoPath: Uri;
  defaultRepoUrl: string = 'https://github.com/ChrisKader/wow-addon-template/'
  defaultLibraryFile: string = 'libs.json'
  initialized: boolean = false
  localRepoInitialized: boolean = false;
  libraryList: ILibraryEntry[] = []
  _state = 'uninitialized'
	private _onDidChangeState = new EventEmitter<string>();
	readonly onDidChangeState = this._onDidChangeState.event;

  setState(state: string): void {
		this._state = state;
		this._onDidChangeState.fire(state);
		Commands.executeCommand('setContext', 'wad.state', state);
	}

  constructor(
    public context: ExtensionContext,
    public neededScms: {scm:Scm, git:TScm,svn:TScm},
    public notificationProvider: WadNotifcationProvider,
  ) {
    Workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, this.disposables)
    Window.onDidChangeVisibleTextEditors(this.onDidChangeVisibleTextEditors, this, this.disposables);
    Workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);
    neededScms.scm.onCheckedOutDir(this.onCheckedOutDir, this, this.disposables);

    this.localRepoPath = Uri.joinPath(context.extensionUri, 'repoDir')

    const fsWatcher = Workspace.createFileSystemWatcher('**');
    this.disposables.push(fsWatcher);

    const onWorkspaceChange = anyEvent(fsWatcher.onDidChange, fsWatcher.onDidCreate);
    const onTrackedFileChange = filterEvent(onWorkspaceChange, uri => this.checkIfInWorkspace(uri));
    const onNotInIgnoredFolder = filterEvent(onTrackedFileChange, uri => !this.ignoredFolders.some(f => uri.toString(true).includes(f)));
    onNotInIgnoredFolder(this.watchedFileUpdated, this, this.disposables);

    const onWorkspaceDelete = anyEvent(fsWatcher.onDidDelete)
    const onTrackedFileDelete = filterEvent(onWorkspaceDelete, uri => this.checkForTrackedFolder(uri))
    onTrackedFileDelete(this.deleteTrackedFile, this, this.disposables)

    context.subscriptions.push(this._addonOutlineTreeView);
    this.doInitialWorkspaceScan().finally(() => {
      this.localRepoSetup().then(() => {
        if (this.localRepoInitialized) {
          log(`local repo setup at ${this.localRepoPath}`)
          this.initialized = true
          this.setState('initialized')
        } else {
          log('Error', 'Failed to setup local repo.')
          this.initialized = false
        }
      }, (_r) => {
        this.initialized = false
      })
    })
  }

  private doInitialWorkspaceScan = async () => {
    this.onDidChangeWorkspaceFolders({ added: Workspace.workspaceFolders || [], removed: [] })
  }

  dispose(): void {
    this.disposables = dispose(this.disposables);
  }
}