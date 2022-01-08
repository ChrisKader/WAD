import { Disposable, Event, EventEmitter, ExtensionContext, FileSystemWatcher, FileType, RelativePattern, TextEditor, Uri, window as Window, workspace as Workspace, WorkspaceFoldersChangeEvent } from 'vscode';
import { AddonOutlineProvider } from './addonOutlineProvider';
import { WadNotifcationProvider } from './notificationProvider';
import { TocFile } from './tocFile';
import { PkgmetaFile } from './pkgmetaFile';
import { anyEvent, dispose, filterEvent, log } from './msutil';
import { Scm } from './Scm';
import {basename as Basename} from 'path';
import { anyEventMore } from './util';

type TrackedFile = TocFile | PkgmetaFile;

interface EventExt extends Event<Uri> {
  type: string;
}

export class WadModel {

  private _onDidUpdateTrackedFile = new EventEmitter<Uri>();
  readonly onDidUpdateTrackedFile: Event<Uri> = this._onDidUpdateTrackedFile.event;

  private _addonOutlineProvider: AddonOutlineProvider = new AddonOutlineProvider();
  private _notificationProvider: WadNotifcationProvider = new WadNotifcationProvider();
  private _addonOutlineTreeView = Window.createTreeView('wadTreeView', { treeDataProvider: this._addonOutlineProvider });

  private disposables: Disposable[] = [];

  trackedFiles: Map<string, TrackedFile> = new Map();
  ignoredFolders = [
    '.svn',
    '.git',
    '.clone',
    '/Libs/',
    '/Library/',
    '/Libraries/'
  ]

  private deleteTrackedFile(uri: Uri) {
    const uriString = uri.toString(true)
    if (this.trackedFiles.has(uriString)) {
      const trackedFile = this.trackedFiles.get(uriString)
      this.trackedFiles.delete(uriString);
      this._onDidUpdateTrackedFile.fire(uri)
      this._addonOutlineProvider.removeTreeItem(trackedFile!.treeItem!)
    } else {
      [...this.trackedFiles].filter(([_,fileUri])=>fileUri.resourceUri.toString(true).includes(uriString)).map(([_,f])=>{
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
    if(uriStat.type === FileType.Directory){
      this.scanFolderForFiles(uri)
    } else {
      let fileToAdd = {} as TrackedFile
      if (/pkgmeta/.test(uriString)) {
        fileToAdd = new PkgmetaFile(uri);
        await fileToAdd.initialized;
      } else if (/.+\.toc/.test(uriString)) {
        fileToAdd = new TocFile(uri);
        await fileToAdd.initialized;
      }
      this.updateTrackedFiles(uri,fileToAdd);
    }
  }

  checkoutDirs: Map<string, Uri> = new Map<string, Uri>();
  trackedWorkspaceFolders: Map<string, Uri> = new Map<string, Uri>();

  private checkIgnoredList = (uri: Uri) => {
    return !this.ignoredFolders.some(i => uri.toString(true).includes(i))
  }

  private scanFolderForFiles = async (uri:Uri) => {
    log(uri);
    (await Workspace.findFiles(new RelativePattern(uri,'**/{*.toc,.pkgmeta*,pkgmeta*.yaml,pkgmeta*.yml}'))).filter(f=>this.checkIgnoredList(f))
    .map(f => this.watchedFileUpdated(f))
  }

  private onDidChangeWorkspaceFolders = async ({ added, removed }: WorkspaceFoldersChangeEvent): Promise<void> => {
    const workspaceFoldersToAdd = added.filter(f => !this.trackedWorkspaceFolders.has(f.uri.toString(true)))
    const workspaceFoldersToRemove = removed.filter(f => this.trackedWorkspaceFolders.has(f.uri.toString(true)))

    workspaceFoldersToRemove.forEach(f => [...this.trackedFiles].filter(([s,_])=> s.includes(f.uri.toString(true))).map(([s,t])=> {
      this.deleteTrackedFile(t.resourceUri)
      this.checkoutDirs.delete(f.uri.toString(true))
      this.trackedWorkspaceFolders.delete(f.uri.toString(true))
    }))

    workspaceFoldersToAdd.map(f => {
      this.checkoutDirs.set(f.uri.toString(true), Uri.joinPath(f.uri, '.release', '.checkout'))
      this.scanFolderForFiles(f.uri)
    })
  }

  private onDidChangeVisibleTextEditors = async (editors: readonly TextEditor[]): Promise<void> => {

  }

  private onDidChangeConfiguration = (): void => {

  }

  private checkIfInWorkspace = (uri: Uri) => {
    return typeof(Workspace.getWorkspaceFolder(uri)) !== 'undefined'
  }

  private checkFileTrackingEligibility(uri: Uri) {
    return /(?:^(?:(?:\.(?!.+\.(?:(yaml)|(?:yml))$))|(?:^(?=[^\.]+\.(?:(yaml)|(?:yml))$)))(?<pkg>pkgmeta(?:-(?:(?:bcc)|(?:mainline)|(?:classic)))?(?:\.(?:(yaml)|(?:yml)))?)$)|(?:(?<toc>.+\.toc)$)/i.test(Basename(uri.toString(true)))
  }

  private checkForTrackedFolder = (uri: Uri) => {
    const uriStr = uri.toString(true);
    return [...this.trackedFiles].some(([_,fileUri])=>{
      return fileUri.resourceUri.toString(true).includes(uriStr)
    })
  }

  initialized: boolean = false
  constructor(
    public context: ExtensionContext
  ) {
    Workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, this.disposables)
    Window.onDidChangeVisibleTextEditors(this.onDidChangeVisibleTextEditors, this, this.disposables);
    Workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);

    const fsWatcher = Workspace.createFileSystemWatcher('**');
    this.disposables.push(fsWatcher);

    const onWorkspaceChange = anyEvent(fsWatcher.onDidChange, fsWatcher.onDidCreate);
    const onTrackedFileChange = filterEvent(onWorkspaceChange, uri => this.checkIfInWorkspace(uri));
    const onNotInIgnoredFolder = filterEvent(onTrackedFileChange, uri => !this.ignoredFolders.some(f => uri.toString(true).includes(f)));
    onNotInIgnoredFolder(this.watchedFileUpdated, this, this.disposables);

    const onWorkspaceDelete = anyEvent(fsWatcher.onDidDelete)
    const onTrackedFileDelete = filterEvent(onWorkspaceDelete, uri => this.checkForTrackedFolder(uri))
    onTrackedFileDelete(this.deleteTrackedFile,this,this.disposables)

    context.subscriptions.push(this._addonOutlineTreeView);
    this.doInitialWorkspaceScan().finally(() => this.initialized = true)
  }
  private doInitialWorkspaceScan = async () => {
    this.onDidChangeWorkspaceFolders({ added: Workspace.workspaceFolders || [], removed: [] })
  }

  dispose(): void {
    this.disposables = dispose(this.disposables);
  }
}