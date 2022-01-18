import { CancellationToken, HoverProvider, ExtensionContext, extensions as Extensions, Hover, languages as Languages, MarkdownString, OverviewRulerLane, Position, Range, ShellExecution, TextDocument, window as Window, workspace as Workspace, Location, ProviderResult, tasks, Uri, workspace, DocumentSelector } from 'vscode';
import { log } from './msutil';
import {IEscStrsInfo, LuaEscStrs} from './readLua'
let cachedDocument: Uri | undefined = undefined;
let cachedScripts: IEscStrsInfo | undefined = undefined;

export function invalidateHoverScriptsCache(document?: TextDocument) {
  if (!document) {
    cachedDocument = undefined;
    return;
  }
  if (document.uri === cachedDocument) {
    cachedDocument = undefined;
  }
}

export class LuaEscapedStringsHoverProvider implements HoverProvider {
  luaEscapedStringsParser = new LuaEscStrs()

  constructor(private context: ExtensionContext) {
		context.subscriptions.push(workspace.onDidChangeTextDocument((e) => {
			invalidateHoverScriptsCache(e.document);
		}));
	}

	public provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
		let hover: Hover | undefined = undefined;

 		if (!cachedDocument || cachedDocument.fsPath !== document.uri.fsPath) {
			cachedScripts = this.luaEscapedStringsParser.parseDoc(document)
			cachedDocument = document.uri;
		}

		cachedScripts?.escStrings.forEach(({ type,value,valueRange }) => {
			if (valueRange.contains(position)) {
				let contents: MarkdownString = new MarkdownString('\n');
        contents.isTrusted = true;
        contents.supportHtml = true;
        contents.appendMarkdown(value);
				hover = new Hover(contents,valueRange);
			}
		});
		return hover;
	}

}

export function registerHoverProvider(context: ExtensionContext): LuaEscapedStringsHoverProvider | undefined {
	if (Workspace.workspaceFolders) {
		let npmSelector: DocumentSelector = {
			language: 'lua',
			scheme: 'file',
			pattern: '**/*.lua'
		};
		let provider = new LuaEscapedStringsHoverProvider(context);
		context.subscriptions.push(Languages.registerHoverProvider(npmSelector, provider));
		return provider;
	}
	return undefined;
}