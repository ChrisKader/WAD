import { Event, EventEmitter, ProviderResult, TreeDataProvider, TreeItemCollapsibleState } from 'vscode';
import { WadTreeItem, WadTreeItemRoot } from './treeItem';
import { TocFile } from './tocFile';

export class AddonOutlineProvider implements TreeDataProvider<WadTreeItem> {

  private _rootItems: Map<string,WadTreeItem> = new Map();

  private _treeItems: Map<string,(WadTreeItem)> = new Map();

  private _onDidUpdateTocFile = new EventEmitter<TocFile>();
  readonly onDidUpdateTocFile: Event<TocFile> = this._onDidUpdateTocFile.event;

  private _onDidChangeTreeData = new EventEmitter<void | WadTreeItem | null | undefined>();
  readonly onDidChangeTreeData?: Event<void | WadTreeItem | null | undefined> | undefined = this._onDidChangeTreeData.event;

  public removeTreeItem(treeItem: WadTreeItem){
    const didDelete = this._treeItems.delete(treeItem.id)
    this.refresh(treeItem)
    return didDelete;
  }

  public addTreeItems(treeItem: WadTreeItem){
    const existingTreeItem = this._treeItems.has(treeItem.id);
    this._treeItems.set(treeItem.id,treeItem);
    this.refresh(existingTreeItem ? treeItem : undefined);
    //this.refresh(existingTreeItem ? treeItem.treeItem : undefined);
  }

  getChildren(element?: WadTreeItem): ProviderResult<WadTreeItem[]> {
    if(element && element.children && element.children.length > 0 ){
      return element.children;
    }

    return [...this._rootItems].map(([,rootItem])=>{
      rootItem.children = [...this._treeItems].filter(([_,t])=>t.fileType === rootItem.fileType).map(([,t])=>t);
      rootItem.description = rootItem.root ? rootItem.children.length.toString() : undefined;
      rootItem.collapsibleState = rootItem.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
      return rootItem;
    });
  }

  getTreeItem(element: WadTreeItem): WadTreeItem {
    return element;
  }

  getParent(wadTreeItem: WadTreeItem):WadTreeItem | undefined {
    return [...this._treeItems].map(([_,v])=>v).find(v => {
      v.id === wadTreeItem.parentId;
    });
  }

  refresh(treeItem?: WadTreeItem) {
		if (treeItem) {
      this._onDidChangeTreeData.fire(treeItem);
		}
    this._onDidChangeTreeData.fire();
	}

  constructor(){
    const rootTemplates = [['tocFiles','TOC Files', 'toc'],['pkgMetaFiles','Pkg Meta Files', 'pkgmeta']];

    rootTemplates.map(([id, label, fileType])=>{
      this._rootItems.set(id,new WadTreeItemRoot(id, label, fileType));
    });
  }
}