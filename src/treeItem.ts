import { ThemeIcon, TreeItem, TreeItemCollapsibleState, TreeItemLabel, Uri } from "vscode";
import { v4 } from 'uuid';

export interface WadTreeItemOptions {
  label: string | TreeItemLabel;
  type: string,
  children?: WadTreeItem[];
  uri?: Uri;
  description?: TreeItem['description'];
  collapsibleState?: TreeItemCollapsibleState;
  tooltip?: TreeItem['tooltip'];
  iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon
  root?: boolean;
}

export class WadTreeItem extends TreeItem {
  public readonly id: string;
  public readonly root: boolean = false;
  public label: TreeItem['label'];
  public type: string;
  public uri?: Uri;
  public description?: TreeItem['description'];
  public tooltip?: TreeItem['tooltip'];
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
    this.root = options.root || this.root;
    this.type = options.type;
    this.id = `${this.type}${this.root ? '-root-' : '-'}${v4()}`;
    this.label = options.label;
    this._children = options.children || [];
    this.collapsibleState = options.collapsibleState ? options.collapsibleState : this._children.length > 0 || this.root ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
    this.uri = options.uri;
    this.description = this.root ? this._children.length.toString() : options.description;
    this.tooltip = options.tooltip;
    this.iconPath = options.iconPath;
  }
}