import { CancellationToken, HoverProvider, ExtensionContext, extensions as Extensions, Hover, languages as Languages, MarkdownString, OverviewRulerLane, Position, Range, ShellExecution, TextDocument, window as Window, workspace as Workspace, Location, ProviderResult, tasks, Uri, workspace, DocumentSelector } from 'vscode';
import {ILuaEscapedStringsInfo, readLua} from './readLua'
let cachedDocument: Uri | undefined = undefined;
let cachedScripts: ILuaEscapedStringsInfo | undefined = undefined;

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
  constructor(private context: ExtensionContext) {
		context.subscriptions.push(workspace.onDidChangeTextDocument((e) => {
			invalidateHoverScriptsCache(e.document);
		}));
	}

	public provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
		let hover: Hover | undefined = undefined;

		if (!cachedDocument || cachedDocument.fsPath !== document.uri.fsPath) {
			cachedScripts = readLua(document);
			cachedDocument = document.uri;
		}

		cachedScripts?.escapedStrings.forEach(({ name, nameRange,value,valueRange }) => {
			if (nameRange.contains(position)) {
				let contents: MarkdownString = new MarkdownString(value + '\n\n');
				contents.isTrusted = true;
        contents.supportHtml = true;
				hover = new Hover(contents,nameRange);
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