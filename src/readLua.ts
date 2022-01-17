import { Range, Location, TextDocument, Position } from "vscode";
import {Options,parse as luaparse, Node, Identifier, Parser, Token} from 'luaparse'
import { log, pathEquals } from "./msutil";

export interface ILuaEscapedStringsReference {
  name: string;
  value: string;
  nameRange: Range;
  valueRange: Range;
}

export interface ILuaEscapedStringsInfo {
  location: Location;
  escapedStrings: ILuaEscapedStringsReference[];
}

export const readLua = (document: TextDocument, buffer = document.getText()): ILuaEscapedStringsInfo | undefined => {
  let start: Position | undefined;
  let end: Position | undefined;
  let inString = false;
  let inColoredString = false
  let currentNode: Node

  let localDeclarations: Identifier[] = []
  let nodes: Node[] = []
  let buildingString: { name: string; nameRange: Range } | void;
  let scope = 0;
  const escapedStrings: ILuaEscapedStringsReference[] = [];

  const previousNode = (): Node => {
    return nodes[nodes.length - 2]
  }

  const regexes = {
    coloredString: /(?:\|c(?<a>[a-f0-9]{2})(?<r>[a-f0-9]{2})(?<g>[a-f0-9]{2})(?<b>[a-f0-9]{2})(?<t>[^"]*?(?=(?<e>\|[rc]|$))))/gmi
  }

  const OnStringLiteral = (raw: string) => {
    const prvNode = previousNode()
    if (prvNode && prvNode.type === 'Identifier' && regexes.coloredString.test(raw)) {
      regexes.coloredString.lastIndex = 0;
      inColoredString = true
      buildingString = {
        name: prvNode.name,
        nameRange: new Range(new Position(prvNode.loc!.start.line - 1,prvNode.loc!.start.column), new Position(prvNode.loc!.end.line - 1,prvNode.loc!.end.column))
      }
      const coloredString = [...raw.matchAll(regexes.coloredString)]
      const hoverData = coloredString.map(v=>{
        return `<span style='color:#${v.groups!.r}${v.groups!.g}${v.groups!.b};'>${v.groups!.t}</span>`
      }).join('');

      escapedStrings.push({
        ...buildingString,
        value: hoverData,
        valueRange: new Range(new Position(currentNode.loc!.start.line - 1,currentNode.loc!.start.column), new Position(currentNode.loc!.end.line - 1,currentNode.loc!.end.column))
      })
      buildingString = undefined
    }
    regexes.coloredString.lastIndex = 0;
  }

  const luaParseOptions:Options = {
    wait: false,
    comments: true,
    scope: true,
    locations: true,
    ranges: true,
    luaVersion: '5.1',
    encodingMode: 'none',
    extendedIdentifiers: false,

    onCreateNode: (node):void => {
      nodes.push(node)
      currentNode = node;
      if (node.type === 'StringLiteral' && node.loc) {
        inString = true
        start = new Position(node.loc.start.line, node.loc.start.column)
        end = new Position(node.loc.end.line, node.loc.end.column);
        const prvNode = previousNode()
        OnStringLiteral(node.raw)
      }
    },

    onCreateScope: ():void => {
      scope++;
    },
    onDestroyScope: ():void => {
      scope--;
    },

    onLocalDeclaration: (identifier):void => {
      localDeclarations.push(identifier)
    },
  };

  luaparse(buffer, luaParseOptions)

  if (start === undefined) {
    return undefined;
  }

  return { location: new Location(document.uri, new Range(start, end ?? start)), escapedStrings };
};