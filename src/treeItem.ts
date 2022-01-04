import { ThemeIcon, TreeItem, TreeItemCollapsibleState, TreeItemLabel, Uri } from "vscode";
import { v4 } from 'uuid';

export interface WadTreeItemOptions {
  [key:string]:any;
  iconPath?: TreeItem["iconPath"];
  description?: TreeItem["description"];
  resourceUri?: TreeItem["resourceUri"];
  tooltip?: TreeItem["tooltip"];
  command?: TreeItem["command"];
  collapsibleState?: TreeItem["collapsibleState"];
  contextValue?: TreeItem["contextValue"];

  label: string | TreeItemLabel;
  type: string,
  children?: WadTreeItem[];
  uri?: Uri;
  root?: boolean;
};

export class WadTreeItem extends TreeItem {
  public readonly id: string;
  public readonly root: boolean = false;
  public label: TreeItem['label'];
  public type: string;
  public uri?: Uri;
  public parentId?: string;

  private _children: WadTreeItem[] = [];

  get children(): WadTreeItem[]{
    return this._children.map(child => {
      child.parentId = this.id;
      return child;
    });
  };

  set children(children:WadTreeItem[]){
    this._children = children;
  }

  constructor(
    options:WadTreeItemOptions
  )
  {
    super(options.label);
    this.iconPath = options.iconPath;
    this.description = options.description;
    this.resourceUri = options.resourceUri;
    this.tooltip = options.tooltip;
    this.command = options.command;
    this.collapsibleState = options.collapsibleState;
    this.contextValue = options.contextValue;
    this.uri = options.uri;
    this.type = options.type;
    this.root = options.root || this.root;
    this.id = `${this.type}${this.root ? '-root-' : '-'}${v4()}`;
    this._children = options.children || [];
    this.collapsibleState = options.collapsibleState ? options.collapsibleState : this._children.length > 0 || this.root ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    this.description = this.root ? this._children.length.toString() : this.description;
  }
}