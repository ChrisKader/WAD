import { ThemeIcon, TreeItem, TreeItemCollapsibleState, TreeItemLabel, Uri } from "vscode";
import { v4 } from 'uuid';

export interface WadTreeItemOptions {
  iconPath?: TreeItem["iconPath"];
  description?: TreeItem["description"];
  resourceUri?: TreeItem["resourceUri"];
  tooltip?: TreeItem["tooltip"];
  command?: TreeItem["command"];
  collapsibleState?: TreeItem["collapsibleState"];
  contextValue?: TreeItem["contextValue"];
  id?:string;
  label: string | TreeItemLabel;
  fileType: string,
  children?: WadTreeItem[];
  uri?: Uri;
  root?: boolean;
};

export class WadTreeItem extends TreeItem {
  public readonly id: string = v4();
  public readonly root: boolean = false;
  public label: TreeItem['label'];
  public fileType: string;
  public uri?: Uri;
  public parentId?: string;
  public children: WadTreeItem[];
/*   private _children: WadTreeItem[] = [];

  get children(){
    return this._children.map(c => {
      c.parentId = this.id;
      return c;
    });
  } */

  constructor(
    options:WadTreeItemOptions
  )
  {
    super(options.label);
    this.id = options.id || this.id;
    this.iconPath = options.iconPath;
    this.description = options.description;
    this.resourceUri = options.resourceUri;
    this.tooltip = options.tooltip;
    this.command = options.command;
    this.collapsibleState = options.collapsibleState;
    this.contextValue = options.contextValue;
    this.uri = options.uri;
    this.fileType = options.fileType;
    this.children = options.children ? options.children?.map(c => { c.parentId = this.id; return c; }) : [];
    this.collapsibleState = options.collapsibleState ? options.collapsibleState : this.children.length > 0 || this.root ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    this.description = this.root ? this.children.length.toString() : this.description;
  }
}

export class WadTreeItemRoot extends TreeItem {
  public readonly id: string = v4();
  public _id: string;
  public readonly root: boolean = true;
  public label: TreeItem['label'];
  public fileType: string;
  public children: WadTreeItem[] = [];

  constructor(
    id: string,
    label: string,
    fileType: string,
  )
  {
    super(label);
    this._id = id;
    this.fileType = fileType;
    this.collapsibleState = this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    this.description = this.children.length.toString();
    this.contextValue = `${this.fileType}Root`;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed
  }
}