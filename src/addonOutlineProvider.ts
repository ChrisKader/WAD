import { Event, EventEmitter, ProviderResult, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { WadTreeItem } from "./treeItem";
import { TocFile } from "./tocFile";

export class AddonOutlineProvider implements TreeDataProvider<WadTreeItem> {

  private _rootItems: Map<string,WadTreeItem> = new Map([
    ['tocFiles',new WadTreeItem({label:'TOC Files',type: 'toc', root: true})],
    ['pkgMetaFiles',new WadTreeItem({label: 'Pkg Meta Files', type: 'pkgmeta', root: true})]
  ]);

  private _treeItems: Map<string,(WadTreeItem)> = new Map();

  private _onDidUpdateTocFile = new EventEmitter<TocFile>();
  readonly onDidUpdateTocFile: Event<TocFile> = this._onDidUpdateTocFile.event;

  private _onDidChangeTreeData = new EventEmitter<void | WadTreeItem | null | undefined>();
  readonly onDidChangeTreeData?: Event<void | WadTreeItem | null | undefined> | undefined = this._onDidChangeTreeData.event;

  public addTreeItems(treeItem: WadTreeItem){
    const existingTreeItem = this._treeItems.has(treeItem.id);
    this._treeItems.set(treeItem.id,treeItem);
    this.refresh(existingTreeItem ? treeItem : undefined);
    //this.refresh(existingTreeItem ? treeItem.treeItem : undefined);
  }

  getChildren(element?: WadTreeItem): ProviderResult<WadTreeItem[]> {
    if(element && element.children ){
      return element.children;
    }

    const rtnOBj = [...this._rootItems].map(([,rootItem])=>{
      const rootChildren = [...this._treeItems].filter(([_,t])=>t.type === rootItem.type).map(([,t])=>t);
      rootItem.children = rootChildren;
      rootItem.description = rootItem.root ? rootChildren.length.toString() : '';
      rootItem.collapsibleState = rootChildren.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
      return rootItem;
    });
    return rtnOBj;
  }

  getTreeItem(element: WadTreeItem): WadTreeItem | Thenable<WadTreeItem> {
    return element;
  }

  getParent(wadTreeItem: WadTreeItem):WadTreeItem | undefined {
    return [...this._treeItems].map(([_,v])=>v).find(v => {
      v.id === wadTreeItem.parentId;
    });
  };

  refresh(treeItem?: WadTreeItem) {
		if (treeItem) {
      this._onDidChangeTreeData.fire(treeItem);
		}
    this._onDidChangeTreeData.fire();
	}

  constructor(){

  }
}