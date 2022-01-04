import { RelativePattern, TreeItem, TreeItemCollapsibleState, Uri, workspace as Workspace } from 'vscode';
import {basename as Basename, dirname as Dirname, join as Join} from 'path';
import { WadTreeItem, WadTreeItemOptions } from './treeItem';

interface TocFileEntry {
  line: number;
  type: 'blank' | 'metadata' | 'comment' | 'file' | 'directiveStart' | 'directiveFill' | 'directiveEnd' | 'unknown'
  field: string;
  value: string;
  column:{
    field: number;
    value: number;
  }
}

export class TocFile {
  private _regExs = {
    lines: /^(?<line>.*?)$\r?\n?/gm,
    metaData: {
      check: /^## /,
      parse: /^## ?(?<field>.+?): ?(?<value>[\S ]*?)$/gm,
    },
    directive: {
      check: /#@.+@$/,
      start: /#@(?!end-)(?<name>.+)@/gm,
      end: /#@end-(?<name>.+)@/gm
    },
    comment: {
      check: /^#(?!#) ?/,
      parse: /g/,
    },
    files: {
      check: /^[\S]+\.[a-z]+$/,
      parse: /^(?<file>[\S]+\.(?<ext>[a-z]+))/gm
    },
  };
  entries: TocFileEntry[] = [];
  initialized: Promise<boolean>;

  get baseDir(){
    return this.resourceUri.with({
      path: Dirname(this.resourceUri.fsPath)
    });
  }

  get title(){
    const metadataTitle = this.entries.find(entry => entry.type === 'metadata' && entry.field === 'Title');
    return metadataTitle?.value || 'Loading';
  }
  get workspaceRelativePath(){
    return this.resourceUri.fsPath.replace(Workspace.getWorkspaceFolder(this.resourceUri)!.uri.fsPath,'');
  }

  private get treeItemEntries(){
    return this.entries.filter(entry => entry.type === 'metadata').map(entry => {
      let wadItemTreeOptions: WadTreeItemOptions = {
        type: 'toc',
        label: entry.field,
        description: entry.value,
        uri: this.resourceUri,
      };
      return new WadTreeItem(wadItemTreeOptions);
    });
  }

  get treeItem(): WadTreeItem {
    let wadItemTreeOptions: WadTreeItemOptions = {
      type: 'toc',
      label: this.title,
      children: this.treeItemEntries,
      description: Basename(this.resourceUri.fsPath),
      uri: this.resourceUri,
      tooltip: this.workspaceRelativePath
    };
    return new WadTreeItem(wadItemTreeOptions);
  }

  private async _initialize(): Promise<boolean>{
    const tocFileString = (await Workspace.fs.readFile(this.resourceUri)).toString();

    const tocFileStringRes = [...tocFileString.matchAll(this._regExs.lines)];

      let currentDirectives = new Set<string>();

      for(let lineIndex = 0;lineIndex < tocFileStringRes.length;lineIndex++){
        const lineResult = tocFileStringRes[lineIndex];
        if(lineResult.groups){
          const tocFileLine = lineResult.groups.line || '';
          let tocFileEntry:TocFileEntry = {
            line: lineIndex,
            type: 'unknown',
            field: tocFileLine,
            value: tocFileLine,
            column: {
              field: 0,
              value: 0
            }
          };
          if(tocFileLine.length === 0){
            tocFileEntry.type = 'blank';
          } else if(currentDirectives.size > 0 || this._regExs.directive.check.test(tocFileLine)){
            // Process Directive Block
            // Check if in a directive block.
            if(currentDirectives.size > 0){
              // if in a directive, check if this is the end of it.
              const directiveEndRes = [...tocFileLine.matchAll(this._regExs.directive.end)][0];
              if(directiveEndRes && directiveEndRes.groups && directiveEndRes.groups.name){
                tocFileEntry.type = 'directiveEnd';
                tocFileEntry.value = directiveEndRes.groups.name;
                tocFileEntry.column.value = tocFileLine.indexOf(directiveEndRes.groups.name);

                currentDirectives.delete(directiveEndRes.groups.name);
              } else {
                // if not the end then parse line as if its in a directive.
                // check for nested directive.
                const nestedDirectiveStart = [...tocFileLine.matchAll(this._regExs.directive.start)][0];
                if(nestedDirectiveStart && nestedDirectiveStart.groups && nestedDirectiveStart.groups.name){
                  currentDirectives.add(nestedDirectiveStart.groups.name);
                  tocFileEntry.type = 'directiveStart';
                  tocFileEntry.value = nestedDirectiveStart.groups.name;
                  tocFileEntry.column.field = tocFileLine.indexOf('@'),
                  tocFileEntry.column.value = tocFileLine.indexOf(nestedDirectiveStart.groups.name);
                } else {
                  // not a nested directive so it should be a directive filler line.
                  tocFileEntry.field = [...currentDirectives].pop()!;
                  tocFileEntry.type = 'directiveFill';
                }
              }
            } else {
              // if not in block, check if line is start of one.
              const directiveStart = [...tocFileLine.matchAll(this._regExs.directive.start)][0];
              if(directiveStart && directiveStart.groups && directiveStart.groups.name){
                // set variables for directive info that live outside the loop.
                currentDirectives.add(directiveStart.groups.name);

                tocFileEntry.type = 'directiveStart';
                tocFileEntry.value = directiveStart.groups.name;
                tocFileEntry.column.value = tocFileLine.indexOf(directiveStart.groups.name);
              }
            }
          } else if(this._regExs.metaData.check.test(tocFileLine)){
            // Process metadata
            tocFileEntry.type = 'metadata';
            for(let metaDataResult of tocFileLine.matchAll(this._regExs.metaData.parse)){
              if(metaDataResult.groups && metaDataResult.groups.field){
                const metaDataField = metaDataResult.groups.field;
                const metaDataValue = metaDataResult.groups.value;
                const fieldValueGap = tocFileLine.length - (3 + (metaDataField.length + 1)) - metaDataValue.length + 1;
                const valueStart = 3 + metaDataField.length + fieldValueGap;
                tocFileEntry.field = metaDataField;
                tocFileEntry.value = metaDataValue;
                tocFileEntry.column.field = 3;
                tocFileEntry.column.value = valueStart;
              }
            }
          } else if(this._regExs.files.check.test(tocFileLine)){
            const fileImport = [...tocFileLine.matchAll(this._regExs.files.parse)][0];
            if(fileImport && fileImport.groups && fileImport.groups.file){
              tocFileEntry.type = 'file';
              tocFileEntry.value = Uri.joinPath(this.baseDir,fileImport.groups.file).toString(true);
            }
          } else if(this._regExs.comment.check.test(tocFileLine)){
            tocFileEntry.type = 'comment';
          }
          this.entries.push(tocFileEntry);
        }
      }
      return true;
  }
  constructor(
    public resourceUri: Uri
  ){
    this.initialized = this._initialize();
  }
}