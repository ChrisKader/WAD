import { Disposable, Event, EventEmitter, ExtensionContext, FileSystemWatcher, Uri, window as Window, workspace as Workspace} from 'vscode';
import { AddonOutlineProvider } from './addonOutlineProvider';
import { WadNotifcationProvider } from './notificationProvider';
import { TocFile } from './tocFile';
import { PkgmetaFile } from './pkgmetaFile';
import { anyEvent, dispose, filterEvent, log } from './msutil';
import { Scm } from './Scm';

type TrackedFile = TocFile | PkgmetaFile;
export class WadModel{

  private _onDidUpdateTrackedFile = new EventEmitter<Uri>();
  readonly onDidUpdateTrackedFile: Event<Uri> = this._onDidUpdateTrackedFile.event;

  private _addonOutlineProvider: AddonOutlineProvider = new AddonOutlineProvider();
  private _notificationProvider: WadNotifcationProvider = new WadNotifcationProvider();
  private _addonOutlineTreeView = Window.createTreeView('wadTreeView', { treeDataProvider: this._addonOutlineProvider });

  private disposables: Disposable[] = [];

  trackedFiles: Map<Uri,TrackedFile> = new Map();

  private checkIfInWorkspace(uri: Uri) {
		if (!Workspace.workspaceFolders) {return false;}
		return typeof (Workspace.getWorkspaceFolder(uri)) !== 'undefined';
	}

  private async intialWorkspaceScan(){
    await Workspace.findFiles('**/{*.toc,.pkgmeta*,pkgmeta*.yaml}').then((trackedFileUriArr)=>{
      trackedFileUriArr.map(async (trackedFileUri) => {
        this.watchedFileUpdated(trackedFileUri,'onDidCreate');
      });
    });
  }

  private updateTrackedFiles(uri: Uri, trackedFile: TrackedFile){
    this.trackedFiles.set(uri,trackedFile);
    this._onDidUpdateTrackedFile.fire(uri);
    this._addonOutlineProvider.addTreeItems(trackedFile.treeItem);
  }

  private async watchedFileUpdated(uri: Uri, event: string) {
    const uriString = uri.toString(true);
		this._notificationProvider.outputChannel(`watchedFileUpdated ${uriString} ${event}`, 'model.ts', 0);

		if (/\.?pkgmeta.*(?:\.yaml)?/.test(uriString)) {
      if(event === 'onDidCreate' || event === 'onDidChange' || event === 'onDidDelete'){
        let pkgMetaFile = new PkgmetaFile(uri);
        await pkgMetaFile.initialized;
        this.updateTrackedFiles(uri,pkgMetaFile);
      }
		} else if (/.+\.toc/.test(uriString)) {
      if(event === 'onDidCreate' || event === 'onDidChange' || event === 'onDidDelete'){
        let tocFile = new TocFile(uri);
        await tocFile.initialized;
        this.updateTrackedFiles(uri,tocFile);
      }
		}
	}

  constructor(
    public context: ExtensionContext
  ){
    if(!Workspace.workspaceFolders){
      context.globalState.update('init','noWorkspace');
    } else {
      context.globalState.update('init','initialScan');
    }

    context.subscriptions.push(this._addonOutlineTreeView);
    Promise.all([
      this.intialWorkspaceScan()
    ]);

    const fsWatcher = Workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      fsWatcher,
      filterEvent(fsWatcher.onDidChange, uri => this.checkIfInWorkspace(uri))(e => this.watchedFileUpdated(e,'onDidChange'), this, this.disposables),
      filterEvent(fsWatcher.onDidCreate, uri => this.checkIfInWorkspace(uri))(e => this.watchedFileUpdated(e,'onDidCreate'), this, this.disposables),
      filterEvent(fsWatcher.onDidDelete, uri => this.checkIfInWorkspace(uri))(e => this.watchedFileUpdated(e,'onDidDelete'), this, this.disposables)
    );
  }

  dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}